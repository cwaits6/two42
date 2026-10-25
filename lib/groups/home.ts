import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ActiveGroup } from "@/lib/groups/active";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { ENDED_GRACE_MS, meetingEndMs } from "@/lib/meetings";
import type { Event } from "@/lib/types";

export type HomeEvent = Pick<Event, "id" | "title" | "start_time" | "location">;

export type HomeCard = {
  group: ActiveGroup;
  nextEvent: HomeEvent | null;
  announcementCount: number;
  prayerCount: number;
};

export type ThisWeekRow = {
  event: HomeEvent;
  groupId: string;
};

export type HomeData = { cards: HomeCard[]; thisWeek: ThisWeekRow[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cards and "This week" rows for Home: one read per table across the
 * member's groups, then split per group. The client is a parameter and so
 * untyped as to privilege; every chain carries the caller's validated
 * `orgId` and the member's group ids. Series expand in `timeZone`, the org's
 * zone, so the server's clock never shifts an occurrence's hour.
 *
 * Resolves to null when any read fails: an empty week and zero counts would
 * read as a confident "nothing happening", so the caller renders the failure.
 */
export async function loadHomeCards(
  client: SupabaseClient<Database>,
  opts: { orgId: string; groups: ActiveGroup[]; timeZone: string }
): Promise<HomeData | null> {
  const { orgId, groups, timeZone } = opts;
  const groupIds = groups.map((g) => g.id);
  const now = new Date();
  const nowISO = now.toISOString();
  const windowStart = new Date(now.getTime() - DAY_MS);
  const windowStartISO = windowStart.toISOString();
  const weekEnd = now.getTime() + 7 * DAY_MS;

  const [events, announcements, prayers] = await Promise.all([
    client
      .from("events")
      .select("*")
      .eq("org_id", orgId)
      .in("group_id", groupIds)
      .or(
        `start_time.gte.${windowStartISO},` +
          `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${windowStartISO}))`
      )
      .order("start_time", { ascending: true })
      .limit(500),
    client
      .from("announcements")
      .select("group_id")
      .eq("org_id", orgId)
      .in("group_id", groupIds)
      .eq("is_published", true)
      .lte("published_at", nowISO),
    client
      .from("prayer_wall")
      .select("group_id")
      .eq("org_id", orgId)
      .in("group_id", groupIds)
      .eq("is_answered", false),
  ]);

  const failures = [
    ["events", events.error],
    ["announcements", announcements.error],
    ["prayer_wall", prayers.error],
  ].filter(([, error]) => error);
  if (failures.length > 0) {
    for (const [table, error] of failures) console.error("Home %s read failed:", table, error);
    return null;
  }

  const occurrences = expandUpcomingEvents((events.data ?? []) as Event[], timeZone, windowStart);
  const thisWeek: ThisWeekRow[] = occurrences
    .filter((e) => {
      const start = new Date(e.start_time).getTime();
      return start >= now.getTime() && start < weekEnd;
    })
    .map((e) => ({ event: toHomeEvent(e), groupId: e.group_id }));

  const announcementCounts = countBy((announcements.data ?? []) as { group_id: string }[]);
  const prayerCounts = countBy((prayers.data ?? []) as { group_id: string | null }[]);

  const cards: HomeCard[] = groups.map((group) => {
    const nextEvent =
      occurrences.find(
        (e) =>
          e.group_id === group.id &&
          meetingEndMs(e.start_time, e.end_time) + ENDED_GRACE_MS > now.getTime()
      ) ?? null;
    return {
      group,
      nextEvent: nextEvent ? toHomeEvent(nextEvent) : null,
      announcementCount: announcementCounts.get(group.id) ?? 0,
      prayerCount: prayerCounts.get(group.id) ?? 0,
    };
  });

  return { cards, thisWeek };
}

function countBy(rows: { group_id: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.group_id) continue;
    counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  }
  return counts;
}

function toHomeEvent(event: Event): HomeEvent {
  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    location: event.location,
  };
}
