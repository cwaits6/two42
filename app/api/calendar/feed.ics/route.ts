import { createServiceClient } from "@/lib/supabase/server";
import { generateCombinedICS, type FeedEvent, type ServingICSInput } from "@/lib/ics-utils";
import {
  hashSubscriptionToken,
  subscriptionTokenExpiryDate,
} from "@/lib/calendar/subscription-token";
import type { Event } from "@/lib/types";
import { isMemberRole } from "@/lib/roles";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const groupParam = searchParams.get("group");

  // Require a valid subscription token
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!token || !uuidRegex.test(token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = await createServiceClient();

  // org-anchor: the subscription-token row is the org anchor for this
  // bearer-token flow.
  // The token row is the org anchor for this unauthenticated flow: org_id is
  // stamped at issuance by the authenticated client's DEFAULT, so every query
  // below filters on it. On a service-role client a key-only read spans all
  // orgs the moment a second org exists.
  const { data: sub, error: subError } = await supabase
    .from("calendar_subscription_tokens")
    .select("id, user_id, org_id, expires_at")
    .eq("token_hash", hashSubscriptionToken(token))
    .single();

  if (subError && subError.code !== "PGRST116") {
    console.error("Calendar feed token lookup failed:", subError);
  }

  if (!sub || new Date(sub.expires_at) < new Date()) {
    return new Response("Unauthorized", { status: 401 });
  }

  // The service client bypasses RLS, so re-check membership here:
  // events are only visible to member roles (see "Members can view all
  // events" policy). A token minted by a pending, deleted, or otherwise
  // non-member profile must not grant access to the event feed.
  const { data: owner, error: ownerError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", sub.user_id)
    .eq("org_id", sub.org_id)
    .single();

  // A real (non-PGRST116) failure here is a transient DB error, not an
  // absent or non-member owner — 401 is terminal to a calendar client while
  // 500 is retryable, so the two must not collapse into the same response.
  if (ownerError && ownerError.code !== "PGRST116") {
    console.error("Failed to look up token owner's profile:", ownerError);
    return new Response("Something went wrong", { status: 500 });
  }

  if (!owner || !isMemberRole(owner.role)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Sliding expiration — see subscriptionTokenExpiryDate() for policy. Runs
  // only after the owner passed the role check above: a token minted by a
  // pending or deleted profile must not keep renewing itself.
  const { error: expiryError } = await supabase
    .from("calendar_subscription_tokens")
    .update({ expires_at: subscriptionTokenExpiryDate() })
    .eq("id", sub.id)
    .eq("org_id", sub.org_id);

  if (expiryError) {
    console.error("Failed to extend calendar subscription expiry:", expiryError);
  }

  if (groupParam && !uuidRegex.test(groupParam)) {
    return new Response("Invalid group ID", { status: 400 });
  }

  // The feed spans the owner's groups; the membership list is the group
  // boundary the service client would otherwise bypass. A failed read is a
  // 500: a feed that silently dropped every group would be cached for an hour.
  const { data: memberships, error: membershipsError } = await supabase
    .from("group_members")
    .select("group_id, groups(name)")
    .eq("org_id", sub.org_id)
    .eq("profile_id", sub.user_id);
  if (membershipsError) {
    console.error("Failed to fetch group memberships for calendar feed:", membershipsError);
    return new Response("Something went wrong", { status: 500 });
  }

  const groupNames = new Map<string, string>();
  for (const m of memberships ?? []) {
    const g = m.groups as unknown as { name: string } | Array<{ name: string }> | null;
    groupNames.set(m.group_id as string, (Array.isArray(g) ? g[0]?.name : g?.name) ?? "Group");
  }
  // A group the owner is not in intersects to nothing: an empty feed, never
  // a distinguishing status.
  const groupIds = [...groupNames.keys()].filter((id) => !groupParam || id === groupParam);

  // Bound results to a reasonable time window
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let typedEvents: Event[] = [];
  let servingSignups: ServingICSInput[] = [];
  if (groupIds.length > 0) {
    // org_id filters are required on both reads: the service client bypasses
    // RLS, so without them the feed would span every org's events and signups.
    const [
      { data: events, error: eventsError },
      { data: myServings, error: servingsError },
    ] = await Promise.all([
      supabase
        .from("events")
        .select("*")
        .eq("org_id", sub.org_id)
        .in("group_id", groupIds)
        .eq("is_cancelled", false)
        .gte("start_time", thirtyDaysAgo)
        .order("start_time", { ascending: true })
        .limit(500),
      // Serving signups where this user is an attendee, on the groups' teams
      // (both inner joins filter)
      supabase
        .from("serving_signups")
        .select("id, service_date, teams!inner(name, group_id), serving_signup_attendees!inner(profile_id)")
        .eq("org_id", sub.org_id)
        .in("teams.group_id", groupIds)
        .eq("serving_signup_attendees.profile_id", sub.user_id)
        .gte("service_date", thirtyDaysAgo.slice(0, 10))
        .order("service_date", { ascending: true }),
    ]);

    if (eventsError) {
      console.error("Failed to fetch events for calendar feed:", eventsError);
      return new Response("Failed to fetch events", { status: 500 });
    }

    // Non-fatal: a failed serving-signups read shouldn't take down the events
    // half of the feed, but a silent discard means a member's serving Sundays
    // vanish behind a 200 + max-age=3600, so the client caches the gap.
    if (servingsError) {
      console.error("Failed to fetch serving signups for calendar feed:", servingsError);
    }

    typedEvents = (events ?? []) as Event[];
    servingSignups = (myServings ?? []).map((s) => {
      const team = s.teams as unknown as
        | { name: string; group_id: string }
        | Array<{ name: string; group_id: string }>
        | null;
      const t = Array.isArray(team) ? team[0] : team;
      return {
        signupId: s.id as string,
        serviceDate: s.service_date as string,
        teamName: t?.name ?? "Serving",
        summaryPrefix: groupParam ? undefined : groupNames.get(t?.group_id ?? ""),
      };
    });
  }

  // The merged feed names each event's group; a per-group feed carries no
  // prefix, since the subscriber named the group.
  const feedEvents: FeedEvent[] = typedEvents.map((event) => ({
    event,
    summaryPrefix: groupParam ? undefined : groupNames.get(event.group_id),
  }));

  let icsString: string;
  try {
    icsString = generateCombinedICS(feedEvents, servingSignups);
  } catch (err) {
    console.error("ICS generation failed:", err);
    return new Response("Failed to generate calendar feed", { status: 500 });
  }

  return new Response(icsString, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
