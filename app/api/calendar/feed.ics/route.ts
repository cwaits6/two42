import { createServiceClient } from "@/lib/supabase/server";
import { generateCombinedICS, type ServingICSInput } from "@/lib/ics-utils";
import {
  hashSubscriptionToken,
  subscriptionTokenExpiryDate,
} from "@/lib/calendar/subscription-token";
import type { Event } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const calendarId = searchParams.get("calendar");

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

  if (!owner || !["member", "content_editor", "admin"].includes(owner.role)) {
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

  // Validate calendarId if provided
  if (calendarId && !uuidRegex.test(calendarId)) {
    return new Response("Invalid calendar ID", { status: 400 });
  }

  // Bound results to a reasonable time window
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // org_id filters are required on both reads: the service client bypasses
  // RLS, so without them the feed would span every org's events and signups.
  let query = supabase
    .from("events")
    .select("*")
    .eq("org_id", sub.org_id)
    .gte("start_time", thirtyDaysAgo)
    .order("start_time", { ascending: true })
    .limit(500);

  if (calendarId) {
    query = query.eq("calendar_id", calendarId);
  }

  const [
    { data: events, error: eventsError },
    { data: myServings, error: servingsError },
  ] = await Promise.all([
    query,
    // Serving signups where this user is an attendee (inner join filters results)
    supabase
      .from("serving_signups")
      .select("id, service_date, teams(name), serving_signup_attendees!inner(profile_id)")
      .eq("org_id", sub.org_id)
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

  const typedEvents = (events ?? []) as Event[];

  const servingSignups: ServingICSInput[] = (myServings ?? []).map((s) => {
    const mg = s.teams as unknown as { name: string } | Array<{ name: string }> | null;
    const teamName = (Array.isArray(mg) ? mg[0]?.name : mg?.name) ?? "Serving";
    return { signupId: s.id as string, serviceDate: s.service_date as string, teamName };
  });

  let icsString: string;
  try {
    icsString = generateCombinedICS(typedEvents, servingSignups);
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
