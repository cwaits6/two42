import { createServiceClient } from "@/lib/supabase/server";
import { calendarEntries, generateSingleEventICS, subscriptionWindow } from "@/lib/ics-utils";
import {
  hashSubscriptionToken,
  subscriptionTokenExpiryDate,
} from "@/lib/calendar/subscription-token";
import type { Event } from "@/lib/types";
import type { MeetingFields } from "@/lib/meetings";
import { isMemberRole } from "@/lib/roles";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import { eventPageUrl, groupsHidingMeetingDetails } from "@/lib/calendar/meetingDetails";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

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
  // below filters on it.
  const { data: sub, error: subError } = await supabase
    .from("calendar_subscription_tokens")
    .select("id, user_id, org_id, expires_at")
    .eq("token_hash", hashSubscriptionToken(token))
    .single();

  if (subError && subError.code !== "PGRST116") {
    console.error("Event ICS token lookup failed:", subError);
  }

  if (!sub || new Date(sub.expires_at) < new Date()) {
    return new Response("Unauthorized", { status: 401 });
  }

  // The service client bypasses RLS, so re-check membership here:
  // events are only visible to member roles (see "Members can view all
  // events" policy). A token minted by a pending, deleted, or otherwise
  // non-member profile must not grant access to arbitrary events by UUID.
  // The role check alone was insufficient once org_id landed: role answers
  // *who* may fetch, org_id answers *whose* events — both lookups are scoped
  // to the token row's org.
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

  // A cross-org event id falls out as "not found" — the 404 below is the
  // correct answer (a distinguishing status would be an org-existence oracle).
  // A cancelled date is not found either: there is nothing to put on a calendar.
  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("org_id", sub.org_id)
    .eq("is_cancelled", false)
    .single();

  if (error || !event) {
    return new Response("Event not found", { status: 404 });
  }

  const typedEvent = event as Event;

  // The service client bypasses the group boundary, so the owner's
  // membership of the event's group is re-checked here; a non-member gets
  // the same 404 as a cross-org id.
  const { data: membership, error: membershipError } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("org_id", sub.org_id)
    .eq("profile_id", sub.user_id)
    .eq("group_id", typedEvent.group_id)
    .maybeSingle();
  if (membershipError) {
    console.error("Failed to check group membership for event ICS:", membershipError);
    return new Response("Something went wrong", { status: 500 });
  }
  if (!membership) {
    return new Response("Event not found", { status: 404 });
  }

  // An exception row inherits its series anchor's meeting.
  let meeting: MeetingFields | null = typedEvent;
  if (typedEvent.series_id) {
    const { data: anchor, error: anchorError } = await supabase
      .from("events")
      .select("meeting_url, meeting_id, meeting_passcode, meeting_show_on_dashboard, meeting_lead_minutes")
      .eq("id", typedEvent.series_id)
      .eq("org_id", sub.org_id)
      .eq("group_id", typedEvent.group_id)
      .maybeSingle();
    if (anchorError) {
      console.error("Failed to fetch series meeting for event ICS:", anchorError);
      return new Response("Something went wrong", { status: 500 });
    }
    meeting = anchor;
  }

  // A subscription to a series lists its dates in the window, without the
  // deleted ones and with the moved ones at their new times.
  let entries = [{ event: typedEvent, uid: typedEvent.id }];
  if (!typedEvent.series_id && typedEvent.recurrence_frequency) {
    const { data: exceptions, error: exceptionsError } = await supabase
      .from("events")
      .select("*")
      .eq("series_id", typedEvent.id)
      .eq("org_id", sub.org_id)
      .eq("group_id", typedEvent.group_id);
    if (exceptionsError) {
      console.error("Failed to fetch moved and deleted dates for event ICS:", exceptionsError);
      return new Response("Something went wrong", { status: 500 });
    }
    const { start, end } = subscriptionWindow();
    entries = calendarEntries(
      [typedEvent, ...((exceptions ?? []) as Event[])],
      await orgTimeZoneById(supabase, sub.org_id),
      start,
      end
    );
  }

  let hidingDetails: Set<string>;
  try {
    hidingDetails = await groupsHidingMeetingDetails(supabase, sub.org_id, [typedEvent.group_id]);
  } catch (err) {
    console.error("Failed to load calendar meeting settings for event ICS:", err);
    return new Response("Something went wrong", { status: 500 });
  }

  let icsString: string;
  try {
    icsString = generateSingleEventICS(
      entries,
      meeting,
      hidingDetails.has(typedEvent.group_id) ? eventPageUrl : undefined
    );
  } catch (err) {
    console.error("ICS generation failed:", err);
    return new Response("Failed to generate calendar file", { status: 500 });
  }

  return new Response(icsString, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
