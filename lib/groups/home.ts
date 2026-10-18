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
  /** The event's group, once events carry one; null renders no group chip. */
  groupId: string | null;
};

export type HomeData = { cards: HomeCard[]; thisWeek: ThisWeekRow[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cards and "This week" rows for Home. The contract is per group, but
 * the content tables carry no group_id yet, so the org-wide queries run once
 * and every card shows the same next event and counts, and every row has
 * `groupId: null`. The group-scoped-content ticket makes the body per group
 * without changing the callers. The client is a parameter and so untyped as
 * to privilege; every chain carries the caller's validated `orgId`.
 *
 * Resolves to null when any read fails: an empty week and zero counts would
 * read as a confident "nothing happening", so the caller renders the failure.
 */
export async function loadHomeCards(
  client: SupabaseClient<Database>,
  opts: { orgId: string; groups: ActiveGroup[] }
): Promise<HomeData | null> {
  const { orgId, groups } = opts;
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
      .or(
        `start_time.gte.${windowStartISO},` +
          `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${windowStartISO}))`
      )
      .order("start_time", { ascending: true })
      .limit(500),
    client
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_published", true)
      .lte("published_at", nowISO),
    client
      .from("prayer_wall")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
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

  const occurrences = expandUpcomingEvents((events.data ?? []) as Event[], windowStart);
  const nextEvent =
    occurrences.find(
      (e) => meetingEndMs(e.start_time, e.end_time) + ENDED_GRACE_MS > now.getTime()
    ) ?? null;
  const thisWeek: ThisWeekRow[] = occurrences
    .filter((e) => {
      const start = new Date(e.start_time).getTime();
      return start >= now.getTime() && start < weekEnd;
    })
    .map((e) => ({ event: toHomeEvent(e), groupId: null }));

  const cards: HomeCard[] = groups.map((group) => ({
    group,
    nextEvent: nextEvent ? toHomeEvent(nextEvent) : null,
    announcementCount: announcements.count ?? 0,
    prayerCount: prayers.count ?? 0,
  }));

  return { cards, thisWeek };
}

function toHomeEvent(event: Event): HomeEvent {
  return {
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    location: event.location,
  };
}
