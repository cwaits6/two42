import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupMemberships, requireActiveGroup } from "@/lib/groups/server";
import { EventsPageClient, type CalendarGroup } from "@/components/events/EventsPageClient";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import type { Event } from "@/lib/types";
import type { ReplyRow } from "@/lib/events/replies";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { logError } from "@/lib/log";

/**
 * The calendar at both levels. With `pinnedGroupId` it is that group's
 * calendar; without it, every group the viewer belongs to, each in its own
 * color. The membership list is the authority on which groups' events are
 * read; RLS enforces the same boundary underneath.
 */
export async function CalendarPage({ pinnedGroupId }: { pinnedGroupId?: string }) {
  const memberships = pinnedGroupId
    ? [await requireActiveGroup(pinnedGroupId)]
    : await getGroupMemberships();
  if (memberships.length === 0) redirect("/dashboard");

  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const groups: CalendarGroup[] = memberships.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    isLeader: g.role === "leader",
  }));

  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const oneYearAhead = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // A bounded window: non-recurring events starting in it, plus recurring
  // anchors whose series overlaps it (the anchor may start years earlier).
  // The viewer's replies are one read that serves every date the list shows.
  const [{ data: allEventsRaw, error: allEventsError }, { data: replies, error: rsvpsError }, timeZone] = await Promise.all([
    supabase
      .from("events")
      .select("*")
      .in(
        "group_id",
        groups.map((g) => g.id)
      )
      .lte("start_time", oneYearAhead)
      .or(
        `start_time.gte.${oneYearAgo},` +
          `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${oneYearAgo}))`
      )
      .order("start_time", { ascending: true })
      .limit(500),
    supabase.from("rsvps").select("event_id, user_id, status, occurrence_date").eq("user_id", user.id),
    getOrgTimeZone(),
  ]);
  // A failed read must not pass for an empty calendar or for no replies.
  if (allEventsError || rsvpsError) {
    logError("Failed to load the calendar", allEventsError ?? rsvpsError);
    return (
      <PageContainer size="wide">
        <PageHeader title="Calendar" />
        <ErrorState thing="the calendar" />
      </PageContainer>
    );
  }

  return (
    <PageContainer size="wide">
      <EventsPageClient
        groups={groups}
        allEvents={(allEventsRaw ?? []) as Event[]}
        replies={(replies ?? []) as ReplyRow[]}
        userId={user.id}
        timeZone={timeZone}
      />
    </PageContainer>
  );
}
