import { hashSubscriptionToken, subscriptionTokenExpiryDate } from "@/lib/calendar/subscription-token";
import { suppersICS, formatAddress, type SupperCalendarEntry } from "@/lib/supperClub/ics";
import { partyName } from "@/lib/supperClub/labels";
import { isUuid } from "@/lib/groups/active";
import { logError } from "@/lib/log";
import { isMemberRole } from "@/lib/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { orgTimeZoneById } from "@/lib/time/orgZone";

// The feed carries home addresses: no shared cache may keep it, and the same
// answer goes back for a token that is missing, unknown, replaced or expired.
function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "private, no-store" } });
}

function failed(): Response {
  return new Response("Something went wrong", { status: 500, headers: { "Cache-Control": "private, no-store" } });
}

/** One person's suppers at their own tables, by the token in their private calendar link. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !isUuid(token)) return unauthorized();

  const supabase = await createServiceClient();

  // org-anchor: the supper feed token row resolves the person and their org;
  // every read below filters on that org and on the person's own seats.
  const { data: tok, error: tokError } = await supabase
    .from("supper_feed_tokens")
    .select("profile_id, org_id, expires_at")
    .eq("token_hash", hashSubscriptionToken(token))
    .maybeSingle();
  if (tokError) logError("Supper feed token lookup failed", tokError, { route: "/api/supper-club/feed.ics" });
  if (tokError || !tok || new Date(tok.expires_at) < new Date()) return unauthorized();
  const orgId = tok.org_id;

  const { data: owner, error: ownerError } = await supabase
    .from("profiles")
    .select("role")
    .eq("org_id", orgId)
    .eq("id", tok.profile_id)
    .maybeSingle();
  if (ownerError) {
    logError("Failed to read the supper feed's owner", ownerError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  if (!owner || !isMemberRole(owner.role)) return unauthorized();

  const { error: expiryError } = await supabase
    .from("supper_feed_tokens")
    .update({ expires_at: subscriptionTokenExpiryDate() })
    .eq("org_id", orgId)
    .eq("profile_id", tok.profile_id);
  if (expiryError) logError("Failed to extend the supper feed's expiry", expiryError, { route: "/api/supper-club/feed.ics" });

  const { data: mine, error: mineError } = await supabase
    .from("supper_party_members")
    .select("party_id")
    .eq("org_id", orgId)
    .eq("profile_id", tok.profile_id);
  if (mineError) {
    logError("Failed to read the supper feed's parties", mineError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }

  const myParties = (mine ?? []).map((m) => m.party_id);
  const { data: seats, error: seatsError } = myParties.length
    ? await supabase
        .from("supper_seats")
        .select("table_id, rotation_id, group_id")
        .eq("org_id", orgId)
        .in("party_id", myParties)
        .is("left_at", null)
    : { data: [], error: null };
  if (seatsError) {
    logError("Failed to read the supper feed's seats", seatsError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }

  const groupIds = [...new Set((seats ?? []).map((s) => s.group_id))];
  const { data: on, error: onError } = groupIds.length
    ? await supabase
        .from("group_settings")
        .select("group_id")
        .eq("org_id", orgId)
        .eq("supper_club_enabled", true)
        .in("group_id", groupIds)
    : { data: [], error: null };
  if (onError) {
    logError("Failed to read the supper feed's groups", onError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  const enabled = new Set((on ?? []).map((row) => row.group_id));

  const rotationIds = [...new Set((seats ?? []).filter((s) => enabled.has(s.group_id)).map((s) => s.rotation_id))];
  const { data: rotations, error: rotationsError } = rotationIds.length
    ? await supabase
        .from("supper_rotations")
        .select("id, title")
        .eq("org_id", orgId)
        .in("id", rotationIds)
        .in("status", ["published", "ended"])
    : { data: [], error: null };
  if (rotationsError) {
    logError("Failed to read the supper feed's rotations", rotationsError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  const titles = new Map((rotations ?? []).map((s) => [s.id, s.title]));

  const tableIds = [...new Set((seats ?? []).filter((s) => titles.has(s.rotation_id)).map((s) => s.table_id))];
  const { data: suppers, error: suppersError } = tableIds.length
    ? await supabase
        .from("suppers")
        .select("id, rotation_id, table_id, starts_at, host_party_id")
        .eq("org_id", orgId)
        .in("table_id", tableIds)
    : { data: [], error: null };
  if (suppersError) {
    logError("Failed to read the supper feed's suppers", suppersError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }

  const hostParties = [...new Set((suppers ?? []).map((d) => d.host_party_id).filter((id): id is string => Boolean(id)))];
  const [addressRead, hostRead, hostSeatRead] = hostParties.length
    ? await Promise.all([
        supabase
          .from("supper_party_addresses")
          .select("party_id, address_line1, address_line2, city, state, postal_code")
          .eq("org_id", orgId)
          .in("party_id", hostParties),
        supabase.from("supper_party_members").select("party_id, profile_id").eq("org_id", orgId).in("party_id", hostParties),
        supabase
          .from("supper_seats")
          .select("table_id, party_id")
          .eq("org_id", orgId)
          .in("party_id", hostParties)
          .is("left_at", null),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (addressRead.error) {
    logError("Failed to read the supper feed's addresses", addressRead.error, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  if (hostRead.error) {
    logError("Failed to read the supper feed's hosts", hostRead.error, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  if (hostSeatRead.error) {
    logError("Failed to read the supper feed's host seats", hostSeatRead.error, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  // The same rule as the address policy: a host who has left the table keeps no address on it.
  const seatedHost = new Set((hostSeatRead.data ?? []).map((st) => `${st.table_id}:${st.party_id}`));

  const hostIds = [...new Set((hostRead.data ?? []).map((m) => m.profile_id))];
  const { data: hostProfiles, error: namesError } = hostIds.length
    ? await supabase.from("profiles").select("id, first_name, preferred_name").eq("org_id", orgId).in("id", hostIds)
    : { data: [], error: null };
  if (namesError) {
    logError("Failed to read the supper feed's host names", namesError, { route: "/api/supper-club/feed.ics" });
    return failed();
  }

  const nameOf = new Map((hostProfiles ?? []).map((p) => [p.id, p.preferred_name || p.first_name || ""]));
  const addressOf = new Map((addressRead.data ?? []).map((a) => [a.party_id, formatAddress(a)]));
  const entries: SupperCalendarEntry[] = (suppers ?? []).map((d) => ({
    supperId: d.id,
    startsAt: d.starts_at,
    rotationTitle: titles.get(d.rotation_id) ?? "Supper club",
    hostNames: d.host_party_id
      ? partyName(
          (hostRead.data ?? [])
            .filter((m) => m.party_id === d.host_party_id)
            .map((m) => nameOf.get(m.profile_id) ?? "")
            .filter(Boolean)
        ) || null
      : null,
    address:
      d.host_party_id && seatedHost.has(`${d.table_id}:${d.host_party_id}`)
        ? (addressOf.get(d.host_party_id) ?? null)
        : null,
  }));

  let body: string;
  try {
    body = suppersICS(entries, await orgTimeZoneById(supabase, orgId));
  } catch (err) {
    logError("Failed to build the supper feed", err, { route: "/api/supper-club/feed.ics" });
    return failed();
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}
