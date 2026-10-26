import { DateTime } from "luxon";
import { dayKey } from "@/lib/time/zone";
import type { Event, EventCalendar } from "@/lib/types";

const MAX_OCCURRENCES = 500;

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
  events: (Event & { calendar?: EventCalendar | null })[],
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

/**
 * Compute the approximate number of recurrence intervals between two dates.
 * Returns a conservative (floor - 1) estimate so callers can safely start
 * one step early and let the window/until checks trim the leading edge.
 */
function fastForwardIndex(
  startIso: string,
  freq: string,
  interval: number,
  now: Date
): number {
  const seriesStart = new Date(startIso);
  const msElapsed = now.getTime() - seriesStart.getTime();
  if (msElapsed <= 0) return 0;

  let msPerStep: number;
  if (freq === "daily") msPerStep = interval * 24 * 60 * 60 * 1000;
  else if (freq === "weekly") msPerStep = interval * 7 * 24 * 60 * 60 * 1000;
  else if (freq === "monthly") msPerStep = interval * 30.44 * 24 * 60 * 60 * 1000;
  else msPerStep = interval * 365.25 * 24 * 60 * 60 * 1000; // yearly

  return Math.max(0, Math.floor(msElapsed / msPerStep) - 1);
}

/**
 * Expand a recurring series anchor into its individual occurrences, stepping
 * in `timeZone` (the org's zone). Occurrences whose calendar day in that zone
 * appears in excludedDays are skipped — those days are covered by
 * per-occurrence exception rows.
 *
 * Pass `now` to fast-forward past already-elapsed occurrences so the
 * maxCount budget applies to visible/upcoming instances, not past ones.
 */
export function expandOccurrences(
  event: Event & { calendar?: EventCalendar | null },
  timeZone: string,
  excludedDays?: Set<string>,
  windowEnd?: Date,
  now?: Date
): (Event & { calendar?: EventCalendar | null })[] {
  if (event.series_id) return [event];
  const { recurrence_frequency: freq, recurrence_end_mode: endMode } = event;
  if (!freq) return [event];

  const end = windowEnd ?? new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000);
  const interval = event.recurrence_interval ?? 1;
  const untilDate =
    endMode === "until" && event.recurrence_until
      ? new Date(event.recurrence_until)
      : null;
  const maxCount =
    endMode === "count" ? (event.recurrence_count ?? 1) : MAX_OCCURRENCES;

  // Fast-forward: skip intervals that are already in the past.
  // For count-mode, iEnd is the absolute series cap so we don't overshoot it.
  // For other modes, iEnd lets us generate maxCount upcoming occurrences.
  const iStart = now ? fastForwardIndex(event.start_time, freq, interval, now) : 0;
  const iEnd = endMode === "count" ? maxCount : iStart + maxCount;

  const results: (Event & { calendar?: EventCalendar | null })[] = [];

  for (let i = iStart; i < iEnd; i++) {
    const occStart =
      i === 0
        ? event.start_time
        : addRecurrenceInterval(event.start_time, freq, interval * i, timeZone);
    const occStartDate = new Date(occStart);

    if (occStartDate > end) break;
    if (untilDate && occStartDate > untilDate) break;
    if (excludedDays?.has(dayKey(occStart, timeZone))) continue;

    const occEnd =
      event.end_time
        ? i === 0
          ? event.end_time
          : addRecurrenceInterval(event.end_time, freq, interval * i, timeZone)
        : null;

    // Spread keeps the original `id` — all occurrences of a series navigate
    // to the same event detail page, distinguished only by ?occurrence= param.
    results.push({ ...event, start_time: occStart, end_time: occEnd });
  }

  return results;
}

/**
 * Given a list of all events (anchor rows + exception rows), return expanded
 * upcoming occurrences suitable for a list view, sorted by start_time.
 */
export function expandUpcomingEvents(
  allEvents: (Event & { calendar?: EventCalendar | null })[],
  timeZone: string,
  now: Date = new Date(),
  windowEnd?: Date
): (Event & { calendar?: EventCalendar | null })[] {
  const exceptions = buildExceptionMap(allEvents, timeZone);
  const results: (Event & { calendar?: EventCalendar | null })[] = [];

  for (const e of allEvents) {
    if (e.series_id) {
      // It's an exception — include directly if upcoming
      if (new Date(e.start_time) >= now) results.push(e);
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
