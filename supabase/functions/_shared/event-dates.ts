// The dates of a repeating event, for the reminder job. Mirrors
// addRecurrenceInterval() and expandOccurrences() in lib/recurrence.ts, which
// Deno cannot import (Luxon and the app's path aliases); lib/recurrence.test.ts
// compares the two over a matrix of zones and clock changes and fails when
// they disagree, so a rule changed on one side has to change on the other.
//
// Import-free, on Intl alone, so the app's test runner can load it too.

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(ts: number, zone: string) {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, format);
  }
  const parts = format.formatToParts(new Date(ts));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: n("year"),
    month: n("month"),
    day: n("day"),
    hour: n("hour"),
    minute: n("minute"),
    second: n("second"),
  };
}

/** Minutes east of UTC that `zone` is at the instant `ts`. */
function offsetMinutes(ts: number, zone: string): number {
  const p = localParts(ts, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ts / 1000) * 1000) / 60_000);
}

/** The calendar date of an instant in `zone`, "YYYY-MM-DD". */
export function localDay(iso: string, zone: string): string {
  const p = localParts(new Date(iso).getTime(), zone);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The instant `steps` intervals after `startIso`, keeping the wall-clock time
 * in `zone`: a 7:00 PM series stays at 7:00 PM across a clock change.
 */
export function stepOccurrence(
  startIso: string,
  frequency: string,
  steps: number,
  zone: string,
): string {
  const startTs = new Date(startIso).getTime();
  if (Number.isNaN(startTs)) return startIso;
  const startOffset = offsetMinutes(startTs, zone);
  const p = localParts(startTs, zone);
  const ms = ((startTs % 1000) + 1000) % 1000;

  let year = p.year;
  let month = p.month;
  let addDays = 0;
  if (frequency === "daily") addDays = steps;
  else if (frequency === "weekly") addDays = steps * 7;
  else if (frequency === "monthly") month += steps;
  else year += steps;

  const y = year + Math.floor((month - 1) / 12);
  const m = (((month - 1) % 12) + 12) % 12 + 1;
  // A month too short for the start's day takes its last day.
  const day = Math.min(p.day, daysInMonth(y, m)) + addDays;
  const localTs = Date.UTC(y, m - 1, day, p.hour, p.minute, p.second, ms);

  // The wall clock back to an instant: keep the start's offset when the zone
  // still has it there, else the zone's own; a time the clocks skip lands
  // after the gap.
  let guess = localTs - startOffset * 60_000;
  const second = offsetMinutes(guess, zone);
  if (second !== startOffset) {
    guess -= (second - startOffset) * 60_000;
    const third = offsetMinutes(guess, zone);
    if (second !== third) guess = localTs - Math.min(second, third) * 60_000;
  }
  return new Date(guess).toISOString();
}

/** The columns of an events row that say how it repeats. */
export interface SeriesRule {
  start_time: string;
  recurrence_frequency: string | null;
  recurrence_interval: number | null;
  recurrence_end_mode: string | null;
  recurrence_count: number | null;
  recurrence_until: string | null;
}

// The longest one step of each frequency can be.
const LONGEST_STEP_MS: Record<string, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 31 * DAY_MS,
  yearly: 366 * DAY_MS,
};

/**
 * The starts of the series' dates with `after < start <= upTo`, leaving out
 * any whose calendar day in `zone` is in `excludedDays`.
 */
export function seriesDatesBetween(
  rule: SeriesRule,
  zone: string,
  after: Date,
  upTo: Date,
  excludedDays?: Set<string>,
): string[] {
  const frequency = rule.recurrence_frequency;
  if (!frequency) return [];
  const interval = rule.recurrence_interval ?? 1;
  const until = rule.recurrence_end_mode === "until" && rule.recurrence_until
    ? new Date(rule.recurrence_until).getTime()
    : null;
  const count = rule.recurrence_end_mode === "count" ? (rule.recurrence_count ?? 1) : Infinity;
  const startTs = new Date(rule.start_time).getTime();
  if (Number.isNaN(startTs)) return [];
  const longestStep = (LONGEST_STEP_MS[frequency] ?? LONGEST_STEP_MS.yearly) * interval;
  // No step is longer than longestStep, so this index is at or before the
  // first date after `after`.
  let i = Math.max(0, Math.floor((after.getTime() - startTs) / longestStep) - 1);

  const dates: string[] = [];
  for (; i < count; i++) {
    const start = i === 0
      ? new Date(rule.start_time).toISOString()
      : stepOccurrence(rule.start_time, frequency, interval * i, zone);
    const ts = new Date(start).getTime();
    if (ts > upTo.getTime()) break;
    if (until !== null && ts > until) break;
    if (ts <= after.getTime()) continue;
    if (excludedDays?.has(localDay(start, zone))) continue;
    dates.push(start);
  }
  return dates;
}
