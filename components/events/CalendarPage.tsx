import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGroupMemberships, requireActiveGroup } from "@/lib/groups/server";
import { EventsPageClient, type CalendarGroup } from "@/components/events/EventsPageClient";
import { PageContainer } from "@/components/layout/PageContainer";
import type { Event, Rsvp } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

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
  const [{ data: allEventsRaw, error: allEventsError }, { data: rsvps }, timeZone] = await Promise.all([
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
    supabase.from("rsvps").select("*").eq("user_id", user.id),
    getOrgTimeZone(),
  ]);
  if (allEventsError) {
    console.error("Failed to fetch events:", allEventsError);
  }

  const userRsvps: Record<string, Rsvp> = Object.fromEntries(
    ((rsvps ?? []) as Rsvp[]).map((r) => [r.event_id, r])
  );

  return (
    <PageContainer size="wide">
      <EventsPageClient
        groups={groups}
        allEvents={(allEventsRaw ?? []) as Event[]}
        userRsvps={userRsvps}
        userId={user.id}
        timeZone={timeZone}
      />
    </PageContainer>
  );
}
