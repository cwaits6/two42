import { getJoinState } from "@/lib/meetings";
import { dayKey } from "@/lib/time/zone";
import type { Event, Rsvp } from "@/lib/types";

/** The columns of an rsvps row a reader needs to place it on a date. */
export type ReplyRow = Pick<Rsvp, "event_id" | "user_id" | "status" | "occurrence_date">;

/** What placing a row on a date reads. */
type Placed = Pick<ReplyRow, "event_id" | "user_id" | "occurrence_date">;

/**
 * Which date a reply answers, keyed like the reminder sent record: the series
 * for any of its dates, and the date's calendar day in the church's zone (the
 * day it stood on in the series, for a date edited on its own).
 */
export interface ReplyKey {
  eventId: string;
  date: string;
  /** The row of a date edited on its own, where its replies are saved. */
  editedId: string | null;
}

/** `shown.start_time` is the date shown: an expanded occurrence keeps its series' id. */
export function replyKey(
  shown: Pick<Event, "id" | "start_time" | "series_id" | "series_occurrence_date">,
  zone: string,
): ReplyKey {
  if (shown.series_id) {
    return {
      eventId: shown.series_id,
      date: dayKey(shown.series_occurrence_date ?? shown.start_time, zone),
      editedId: shown.id,
    };
  }
  return { eventId: shown.id, date: dayKey(shown.start_time, zone), editedId: null };
}

// Lower wins. A row with no date covers every date of its event, so it shows
// only where nothing more exact does; a row on an edited date's own id
// overrides the series. Neither exists once rsvps.occurrence_date is NOT NULL
// and every reply sits on its series: these two arms can go once no deployed
// database predates that.
function rank(row: Placed, key: ReplyKey): number | null {
  if (key.editedId && row.event_id === key.editedId) return 0;
  if (row.event_id !== key.eventId) return null;
  if (row.occurrence_date === key.date) return 1;
  if (row.occurrence_date === null) return 2;
  return null;
}

/** Each person's reply to the date `key` names, one per person. */
export function repliesForDate<R extends Placed>(rows: readonly R[], key: ReplyKey): Map<string, R> {
  const best = new Map<string, { row: R; rank: number }>();
  for (const row of rows) {
    const r = rank(row, key);
    if (r === null) continue;
    const held = best.get(row.user_id);
    if (!held || r < held.rank) best.set(row.user_id, { row, rank: r });
  }
  return new Map([...best].map(([userId, { row }]) => [userId, row]));
}

export function replyFor<R extends Placed>(rows: readonly R[], key: ReplyKey, userId: string): R | null {
  return repliesForDate(rows, key).get(userId) ?? null;
}

/**
 * A PostgREST `or()` filter for every row `repliesForDate()` can pick for
 * `key`. Every value is a row id or a `dayKey()`, never request text.
 */
export function replyDateFilter(key: ReplyKey): string {
  const series = `and(event_id.eq.${key.eventId},or(occurrence_date.eq.${key.date},occurrence_date.is.null))`;
  return key.editedId ? `${series},event_id.eq.${key.editedId}` : series;
}

/** A date takes replies until it ends, the same moment the page shows it as ended. */
export function replyOpen(now: Date, startTime: string, endTime: string | null): boolean {
  return getJoinState(now, startTime, endTime, 0) !== "ended";
}
