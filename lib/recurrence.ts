import { DateTime } from "luxon";
import { dayKey } from "@/lib/time/zone";
import type { Event, EventCalendar } from "@/lib/types";

const MAX_OCCURRENCES = 500;

type Series = Event & { calendar?: EventCalendar | null };

/**
 * The instant `steps` intervals after `isoString`, keeping the wall-clock
 * time in `zone`: a 7:00 PM series stays at 7:00 PM across a daylight-saving
 * change in the org's zone, whatever zone the browser or server runs in.
 */
export function addRecurrenceInterval(
  isoString: string,
  frequency: string,
  steps: number,
  zone: string
): string {
  const d = DateTime.fromISO(isoString, { zone });
  if (!d.isValid) return isoString;

  const stepped =
    frequency === "daily"
      ? d.plus({ days: steps })
      : frequency === "weekly"
        ? d.plus({ weeks: steps })
        : frequency === "monthly"
          ? d.plus({ months: steps })
          : d.plus({ years: steps });

  return stepped.toJSDate().toISOString();
}

/**
 * Build a map of { series_id → Set<calendar day in timeZone> } from exception
 * events. Pass this to expandOccurrences so it can skip days covered by
 * exceptions. A series has one occurrence per day, and the day survives what
 * the exact instant does not: rows written under the earlier stepping
 * (overflowed months) or from a browser outside the org zone.
 */
export function buildExceptionMap(
  events: Series[],
  timeZone: string
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.series_id && e.series_occurrence_date) {
      if (!map.has(e.series_id)) map.set(e.series_id, new Set());
      map.get(e.series_id)!.add(dayKey(e.series_occurrence_date, timeZone));
    }
  }
  return map;
}

/** The repeat rule of a series anchor; null for a one-off or an exception row. */
type Rule = Pick<Event, "start_time" | "recurrence_end_mode" | "recurrence_count" | "recurrence_until"> & {
  frequency: NonNullable<Event["recurrence_frequency"]>;
  interval: number;
};

function seriesRule(event: Event): Rule | null {
  if (event.series_id || !event.recurrence_frequency) return null;
  return {
    start_time: event.start_time,
    recurrence_end_mode: event.recurrence_end_mode,
    recurrence_count: event.recurrence_count,
    recurrence_until: event.recurrence_until,
    frequency: event.recurrence_frequency,
    interval: event.recurrence_interval ?? 1,
  };
}

/** `iso` moved `index` intervals along the rule in `timeZone`; index 0 is the row's own value. */
function stepAlong(rule: Rule, iso: string, index: number, timeZone: string): string {
  return index === 0 ? iso : addRecurrenceInterval(iso, rule.frequency, rule.interval * index, timeZone);
}

/**
 * A conservative estimate (floor - 1) of the index of the date at `instant`,
 * so callers can start there and step forward to the exact one. Month and
 * year lengths are averaged slightly high, which keeps the estimate low.
 */
function fastForwardIndex(rule: Rule, instant: Date): number {
  const msElapsed = instant.getTime() - new Date(rule.start_time).getTime();
  if (msElapsed <= 0) return 0;

  const day = 24 * 60 * 60 * 1000;
  const msPerStep =
    rule.frequency === "daily"
      ? rule.interval * day
      : rule.frequency === "weekly"
        ? rule.interval * 7 * day
        : rule.frequency === "monthly"
          ? rule.interval * 30.44 * day
          : rule.interval * 365.25 * day;

  return Math.max(0, Math.floor(msElapsed / msPerStep) - 1);
}

/**
 * How many dates of the series start before `instant`. Steps from the
 * estimated index, so a far-off instant costs a few steps, not one per date.
 */
function occurrencesBefore(rule: Rule, instant: Date, timeZone: string): number {
  let i = fastForwardIndex(rule, instant);
  while (new Date(stepAlong(rule, rule.start_time, i, timeZone)) < instant) i++;
  return i;
}

/** How many dates the series has in all; null when it never ends. */
function seriesLength(rule: Rule, timeZone: string): number | null {
  if (rule.recurrence_end_mode === "count") return rule.recurrence_count ?? 1;
  if (rule.recurrence_end_mode === "until" && rule.recurrence_until) {
    // A date starting exactly at the until instant still belongs to the series.
    const justAfterUntil = new Date(new Date(rule.recurrence_until).getTime() + 1);
    return occurrencesBefore(rule, justAfterUntil, timeZone);
  }
  return null;
}

/**
 * Expand a recurring series anchor into its individual occurrences, stepping
 * in `timeZone` (the org's zone). Occurrences whose calendar day in that zone
 * appears in excludedDays are skipped — those days are covered by
 * per-occurrence exception rows.
 *
 * Pass `now` to fast-forward past already-elapsed occurrences so the
 * MAX_OCCURRENCES budget applies to visible/upcoming instances, not past ones.
 */
export function expandOccurrences(
  event: Series,
  timeZone: string,
  excludedDays?: Set<string>,
  windowEnd?: Date,
  now?: Date
): Series[] {
  const rule = seriesRule(event);
  if (!rule) return [event];

  const end = windowEnd ?? new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
  const iStart = now ? fastForwardIndex(rule, now) : 0;
  const length = seriesLength(rule, timeZone);
  // A series that ends after a count expands every date the leader asked for
  // (the input allows more than the budget); the budget bounds the others.
  const iEnd =
    length === null
      ? iStart + MAX_OCCURRENCES
      : rule.recurrence_end_mode === "count"
        ? length
        : Math.min(length, iStart + MAX_OCCURRENCES);

  const results: Series[] = [];

  for (let i = iStart; i < iEnd; i++) {
    const occStart = stepAlong(rule, rule.start_time, i, timeZone);
    if (new Date(occStart) > end) break;
    if (excludedDays?.has(dayKey(occStart, timeZone))) continue;

    const occEnd = event.end_time ? stepAlong(rule, event.end_time, i, timeZone) : null;

    // Spread keeps the original `id` — all occurrences of a series navigate
    // to the same event detail page, distinguished only by ?occurrence= param.
    results.push({ ...event, start_time: occStart, end_time: occEnd });
  }

  return results;
}

/** The end instant of the occurrence starting at `occurrenceStart`, keeping the series' duration. */
export function occurrenceEndTime(
  series: Pick<Event, "start_time" | "end_time">,
  occurrenceStart: string
): string | null {
  if (!series.end_time) return null;
  const duration = new Date(series.end_time).getTime() - new Date(series.start_time).getTime();
  return new Date(new Date(occurrenceStart).getTime() + duration).toISOString();
}

/**
 * How many dates of a series start at or after `now`, by the series rule
 * alone: a date already removed from the series still counts. Null when the
 * series has no end.
 */
export function countUpcomingOccurrences(
  series: Event,
  timeZone: string,
  now: Date = new Date()
): number | null {
  const rule = seriesRule(series);
  if (!rule) return null;
  const length = seriesLength(rule, timeZone);
  if (length === null) return null;
  return Math.max(0, length - occurrencesBefore(rule, now, timeZone));
}

/**
 * Given a list of all events (anchor rows + exception rows), return expanded
 * upcoming occurrences suitable for a list view, sorted by start_time.
 */
export function expandUpcomingEvents(
  allEvents: Series[],
  timeZone: string,
  now: Date = new Date(),
  windowEnd?: Date
): Series[] {
  const exceptions = buildExceptionMap(allEvents, timeZone);
  const results: Series[] = [];

  for (const e of allEvents) {
    if (e.series_id) {
      // An exception row stands in for its series date; a cancelled one
      // only removes it.
      if (!e.is_cancelled && new Date(e.start_time) >= now) results.push(e);
    } else if (e.recurrence_frequency) {
      // Expand series; keep only upcoming occurrences
      const occurrences = expandOccurrences(e, timeZone, exceptions.get(e.id), windowEnd, now);
      for (const occ of occurrences) {
        if (new Date(occ.start_time) >= now) results.push(occ);
      }
    } else {
      // Regular one-off event — include if upcoming
      if (new Date(e.start_time) >= now) results.push(e);
    }
  }

  return results.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );
}
