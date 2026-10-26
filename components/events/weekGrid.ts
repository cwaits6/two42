// Pure placement math for the Week view. No React, no DOM: every rule here
// is testable with plain values. Times are luxon DateTimes in the org's
// zone, so the grid, "today" and the event times agree with every other
// event surface whatever zone the browser is in.

import { DateTime } from "luxon";

export const GRID_START_HOUR = 6;
export const GRID_END_HOUR = 22;
export const GRID_MINUTES = (GRID_END_HOUR - GRID_START_HOUR) * 60;

/** Height of one grid hour, in pixels. */
export const HOUR_HEIGHT_PX = 64;

/** The shortest block, in pixels: the touch-target floor, which also keeps its time and title legible. */
export const MIN_BLOCK_PX = 44;

const DEFAULT_DURATION_MINUTES = 60;
const MIN_BLOCK_MINUTES = Math.ceil((MIN_BLOCK_PX / HOUR_HEIGHT_PX) * 60);
const LOCALE = "en-US";

export type Placement =
  | { kind: "timed"; topMinutes: number; durationMinutes: number }
  | { kind: "allDay" };

/**
 * Where an event sits in its day column. A start outside 6 am to 10 pm goes
 * to the all-day row; a timed event is clipped at 10 pm and, without an end,
 * drawn as one hour. A block never draws shorter than the minimum, so a late
 * start is moved up until its minimum-length block ends at 10 pm; otherwise
 * the grid would clip it.
 */
export function placeEvent(start: DateTime, end: DateTime | null): Placement {
  const startMinutes = start.hour * 60 + start.minute - GRID_START_HOUR * 60;
  if (startMinutes < 0 || startMinutes >= GRID_MINUTES) return { kind: "allDay" };

  const top = Math.min(startMinutes, GRID_MINUTES - MIN_BLOCK_MINUTES);
  const rawDuration = end
    ? Math.round(end.diff(start, "minutes").minutes)
    : DEFAULT_DURATION_MINUTES;
  const durationMinutes = Math.min(
    GRID_MINUTES - top,
    Math.max(MIN_BLOCK_MINUTES, rawDuration)
  );
  return { kind: "timed", topMinutes: top, durationMinutes };
}

export type Segment = {
  start: DateTime;
  end: DateTime | null;
  /** The event began on an earlier day, so this part starts at midnight. */
  continuesBefore: boolean;
  /** The event runs on past this day's end. */
  continuesAfter: boolean;
};

/**
 * The part of an event that falls on the calendar day `day`, or null when
 * none does. An event without an end, or whose end is not after its start,
 * belongs to its start day only; an end exactly at midnight does not reach
 * into the next day. Multi-day events are drawn once per day they touch.
 */
export function segmentOn(start: DateTime, end: DateTime | null, day: DateTime): Segment | null {
  const dayStart = day.startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  if (!end || end.toMillis() <= start.toMillis()) {
    if (dayKey(start) !== dayKey(dayStart)) return null;
    return { start, end, continuesBefore: false, continuesAfter: false };
  }
  if (start.toMillis() >= dayEnd.toMillis() || end.toMillis() <= dayStart.toMillis()) return null;
  const continuesBefore = start.toMillis() < dayStart.toMillis();
  const continuesAfter = end.toMillis() > dayEnd.toMillis();
  return {
    start: continuesBefore ? dayStart : start,
    end: continuesAfter ? dayEnd : end,
    continuesBefore,
    continuesAfter,
  };
}

/**
 * Where a day's segment sits in its column. A segment that starts on this
 * day follows `placeEvent`. A continuation from an earlier day is drawn from
 * 6 am to its end; when it ends before the grid opens, or covers the whole
 * grid, it goes to the all-day row instead of a full-height block.
 */
export function placeSegment(segment: Segment): Placement {
  if (!segment.continuesBefore || !segment.end) return placeEvent(segment.start, segment.end);
  if (segment.continuesAfter) return { kind: "allDay" };
  // Clock fields, not elapsed time since midnight: a day with a DST change is not 24 hours long.
  const endMinutes = segment.end.hour * 60 + segment.end.minute - GRID_START_HOUR * 60;
  if (endMinutes <= 0 || endMinutes >= GRID_MINUTES) return { kind: "allDay" };
  return { kind: "timed", topMinutes: 0, durationMinutes: Math.max(MIN_BLOCK_MINUTES, endMinutes) };
}

export type Lane = { lane: number; laneCount: number };

/**
 * Side-by-side lanes for the timed events of one column, index-aligned with
 * the input. Events that overlap in time, directly or through a chain of
 * overlaps, form a cluster and share its width equally; each takes the first
 * lane free at its start. Sorted by start, then longest first, so the
 * earliest and longest events keep the leftmost lanes.
 */
export function layoutLanes(spans: { topMinutes: number; durationMinutes: number }[]): Lane[] {
  const order = spans
    .map((span, index) => ({ ...span, index, end: span.topMinutes + span.durationMinutes }))
    .sort((a, b) => a.topMinutes - b.topMinutes || b.end - a.end);

  const lanes: Lane[] = spans.map(() => ({ lane: 0, laneCount: 1 }));
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const index of cluster) lanes[index].laneCount = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const item of order) {
    if (item.topMinutes >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= item.topMinutes);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = item.end;
    lanes[item.index].lane = lane;
    cluster.push(item.index);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  closeCluster();
  return lanes;
}

/** Calendar date as "YYYY-MM-DD", the key that buckets events into day columns. */
export function dayKey(date: DateTime): string {
  return date.toISODate() ?? "";
}

/** Midnight `days` calendar days from `date`'s day. */
export function addDays(date: DateTime, days: number): DateTime {
  return date.startOf("day").plus({ days });
}

/**
 * The locale's first day of the week, 0 = Sunday through 6 = Saturday.
 * Intl's week info is Monday = 1 through Sunday = 7; a runtime without it
 * falls back to Sunday; remove the fallback once every supported browser ships
 * Intl.Locale weekInfo.
 */
export function localeWeekStart(locale: string | undefined): number {
  try {
    const intlLocale = new Intl.Locale(locale ?? LOCALE) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7;
  } catch {
    // An unparseable locale tag; use the fallback.
  }
  return 0;
}

/** The seven midnights of the week that contains `anchor`, starting on `firstDay` (0 = Sunday). */
export function weekDays(anchor: DateTime, firstDay: number): DateTime[] {
  const offset = ((anchor.weekday % 7) - firstDay + 7) % 7;
  const first = addDays(anchor, -offset);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

const monthShort = (date: DateTime) => date.setLocale(LOCALE).toFormat("LLL");

/** "Sep 27 – Oct 3, 2026"; the month is repeated only when it changes, the year only across a year end. */
export function weekTitle(days: DateTime[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (first.year !== last.year) {
    return `${monthShort(first)} ${first.day}, ${first.year} – ${monthShort(last)} ${last.day}, ${last.year}`;
  }
  const end = first.month === last.month ? `${last.day}` : `${monthShort(last)} ${last.day}`;
  return `${monthShort(first)} ${first.day} – ${end}, ${last.year}`;
}

/** The grid's hour rows, 6 AM through 9 PM, each labelled at its top line. */
export function gridHours(): { hour: number; label: string }[] {
  return Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => {
    const hour = GRID_START_HOUR + i;
    return { hour, label: formatHour(hour) };
  });
}

export function formatHour(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(LOCALE, { hour: "numeric" });
}

export function formatTime(date: DateTime): string {
  return date.setLocale(LOCALE).toLocaleString({ hour: "numeric", minute: "2-digit" });
}

/** "Tue" */
export function weekdayShort(date: DateTime): string {
  return date.setLocale(LOCALE).toLocaleString({ weekday: "short" });
}

/** "Fri 7:00 PM": the day is needed when a range crosses midnight. */
export function formatDayTime(date: DateTime): string {
  return `${weekdayShort(date)} ${formatTime(date)}`;
}

/** True when the event's last moment falls on a later calendar day than its start. */
export function spansDays(start: DateTime, end: DateTime | null): boolean {
  if (!end || end.toMillis() <= start.toMillis()) return false;
  return dayKey(end.minus({ milliseconds: 1 })) !== dayKey(start);
}
