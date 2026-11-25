import { hashSubscriptionToken, subscriptionTokenExpiryDate } from "@/lib/calendar/subscription-token";
import { dinnersICS, formatAddress, type DinnerCalendarEntry } from "@/lib/dinnerClub/ics";
import { partyName } from "@/lib/dinnerClub/labels";
import { isUuid } from "@/lib/dinnerClub/routeErrors";
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

/** One person's dinners at their own tables, by the token in their private calendar link. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!isUuid(token)) return unauthorized();

  const supabase = await createServiceClient();

  // org-anchor: the dinner feed token row resolves the person and their org;
  // every read below filters on that org and on the person's own seats.
  const { data: tok, error: tokError } = await supabase
    .from("dinner_feed_tokens")
    .select("profile_id, org_id, expires_at")
    .eq("token_hash", hashSubscriptionToken(token))
    .maybeSingle();
  if (tokError) logError("Dinner feed token lookup failed", tokError, { route: "/api/dinner-club/feed.ics" });
  if (tokError || !tok || new Date(tok.expires_at) < new Date()) return unauthorized();
  const orgId = tok.org_id;

  const { data: owner, error: ownerError } = await supabase
    .from("profiles")
    .select("role")
    .eq("org_id", orgId)
    .eq("id", tok.profile_id)
    .maybeSingle();
  if (ownerError) {
    logError("Failed to read the dinner feed's owner", ownerError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }
  if (!owner || !isMemberRole(owner.role)) return unauthorized();

  const { error: expiryError } = await supabase
    .from("dinner_feed_tokens")
    .update({ expires_at: subscriptionTokenExpiryDate() })
    .eq("org_id", orgId)
    .eq("profile_id", tok.profile_id);
  if (expiryError) logError("Failed to extend the dinner feed's expiry", expiryError, { route: "/api/dinner-club/feed.ics" });

  const { data: mine, error: mineError } = await supabase
    .from("dinner_party_members")
    .select("party_id")
    .eq("org_id", orgId)
    .eq("profile_id", tok.profile_id);
  if (mineError) {
    logError("Failed to read the dinner feed's parties", mineError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }

  const myParties = (mine ?? []).map((m) => m.party_id);
  const { data: seats, error: seatsError } = myParties.length
    ? await supabase
        .from("dinner_seats")
        .select("table_id, season_id, group_id")
        .eq("org_id", orgId)
        .in("party_id", myParties)
        .is("left_at", null)
    : { data: [], error: null };
  if (seatsError) {
    logError("Failed to read the dinner feed's seats", seatsError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }

  const groupIds = [...new Set((seats ?? []).map((s) => s.group_id))];
  const { data: on, error: onError } = groupIds.length
    ? await supabase
        .from("group_settings")
        .select("group_id")
        .eq("org_id", orgId)
        .eq("dinner_club_enabled", true)
        .in("group_id", groupIds)
    : { data: [], error: null };
  if (onError) {
    logError("Failed to read the dinner feed's groups", onError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }
  const enabled = new Set((on ?? []).map((row) => row.group_id));

  const seasonIds = [...new Set((seats ?? []).filter((s) => enabled.has(s.group_id)).map((s) => s.season_id))];
  const { data: seasons, error: seasonsError } = seasonIds.length
    ? await supabase
        .from("dinner_seasons")
        .select("id, title")
        .eq("org_id", orgId)
        .in("id", seasonIds)
        .in("status", ["published", "ended"])
    : { data: [], error: null };
  if (seasonsError) {
    logError("Failed to read the dinner feed's seasons", seasonsError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }
  const titles = new Map((seasons ?? []).map((s) => [s.id, s.title]));

  const tableIds = [...new Set((seats ?? []).filter((s) => titles.has(s.season_id)).map((s) => s.table_id))];
  const { data: dinners, error: dinnersError } = tableIds.length
    ? await supabase
        .from("dinners")
        .select("id, season_id, starts_at, host_party_id")
        .eq("org_id", orgId)
        .in("table_id", tableIds)
    : { data: [], error: null };
  if (dinnersError) {
    logError("Failed to read the dinner feed's dinners", dinnersError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }

  const hostParties = [...new Set((dinners ?? []).map((d) => d.host_party_id).filter((id): id is string => Boolean(id)))];
  const [addressRead, hostRead] = hostParties.length
    ? await Promise.all([
        supabase
          .from("dinner_party_addresses")
          .select("party_id, address_line1, address_line2, city, state, postal_code")
          .eq("org_id", orgId)
          .in("party_id", hostParties),
        supabase.from("dinner_party_members").select("party_id, profile_id").eq("org_id", orgId).in("party_id", hostParties),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (addressRead.error) {
    logError("Failed to read the dinner feed's addresses", addressRead.error, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }
  if (hostRead.error) {
    logError("Failed to read the dinner feed's hosts", hostRead.error, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }

  const hostIds = [...new Set((hostRead.data ?? []).map((m) => m.profile_id))];
  const { data: hostProfiles, error: namesError } = hostIds.length
    ? await supabase.from("profiles").select("id, first_name, preferred_name").eq("org_id", orgId).in("id", hostIds)
    : { data: [], error: null };
  if (namesError) {
    logError("Failed to read the dinner feed's host names", namesError, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }

  const nameOf = new Map((hostProfiles ?? []).map((p) => [p.id, p.preferred_name || p.first_name || ""]));
  const addressOf = new Map((addressRead.data ?? []).map((a) => [a.party_id, formatAddress(a)]));
  const entries: DinnerCalendarEntry[] = (dinners ?? []).map((d) => ({
    dinnerId: d.id,
    startsAt: d.starts_at,
    seasonTitle: titles.get(d.season_id) ?? "Dinner club",
    hostNames: d.host_party_id
      ? partyName(
          (hostRead.data ?? [])
            .filter((m) => m.party_id === d.host_party_id)
            .map((m) => nameOf.get(m.profile_id) ?? "")
            .filter(Boolean)
        ) || null
      : null,
    address: d.host_party_id ? (addressOf.get(d.host_party_id) ?? null) : null,
  }));

  let body: string;
  try {
    body = dinnersICS(entries, await orgTimeZoneById(supabase, orgId));
  } catch (err) {
    logError("Failed to build the dinner feed", err, { route: "/api/dinner-club/feed.ics" });
    return failed();
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" },
  });
}
