import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveGroup } from "@/lib/groups/server";
import { EventsPageClient } from "@/components/events/EventsPageClient";
import { PageContainer } from "@/components/layout/PageContainer";
import type { Event, EventCalendar, Rsvp } from "@/lib/types";

/**
 * The calendar, shared by /calendar and /g/[groupId]/calendar. Events carry
 * no group yet, so both routes list the same rows; `pinnedGroupId` is the
 * group whose calendar this is, and the group whose event pages the rows
 * link to. The org-level calendar links under the viewer's active group.
 */
export async function CalendarPage({ pinnedGroupId }: { pinnedGroupId?: string }) {
  const linkGroupId = pinnedGroupId ?? (await getActiveGroup())?.id;
  if (!linkGroupId) redirect("/dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  const isAdmin = profile?.role === "admin";
  const isMember =
    profile?.role === "member" ||
    profile?.role === "content_editor" ||
    isAdmin;

  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const oneYearAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch events within a bounded window for calendar view.
  // Include non-recurring events whose start_time falls in the window, AND
  // recurring anchors whose series overlaps the window (start_time <= windowEnd
  // and the series hasn't ended before the window start).
  const allEventsQuery = supabase
    .from("events")
    .select("*, calendar:event_calendars(*)")
    .lte("start_time", oneYearAhead)
    .or(
      `start_time.gte.${oneYearAgo},` +
      `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${oneYearAgo}))`
    )
    .order("start_time", { ascending: true })
    .limit(500);

  const { data: allEventsRaw, error: allEventsError } = await allEventsQuery;
  if (allEventsError) {
    console.error("Failed to fetch events:", allEventsError);
  }

  // Fetch event calendars
  const { data: calendarsRaw, error: calendarsError } = await supabase
    .from("event_calendars")
    .select("*")
    .order("name", { ascending: true });
  if (calendarsError) {
    console.error("Failed to fetch event calendars:", calendarsError);
  }

  // Fetch user's RSVPs if logged in
  let userRsvps: Record<string, Rsvp> = {};
  if (user && isMember) {
    const { data: rsvps } = await supabase
      .from("rsvps")
      .select("*")
      .eq("user_id", user.id);
    if (rsvps) {
      userRsvps = Object.fromEntries(rsvps.map((r) => [r.event_id, r]));
    }
  }

  const allEvents = (allEventsRaw ?? []) as (Event & {
    calendar?: EventCalendar | null;
  })[];
  const calendars = (calendarsRaw ?? []) as EventCalendar[];

  return (
    <PageContainer size="wide">
      <EventsPageClient
        groupId={linkGroupId}
        allEvents={allEvents}
        calendars={calendars}
        userRsvps={userRsvps}
        userId={user?.id ?? null}
        isMember={isMember}
        isAdmin={isAdmin}
      />
    </PageContainer>
  );
}
