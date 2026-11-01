import { DateTime } from "luxon";
import { dayKey } from "@/lib/time/zone";

/**
 * Serving dates are calendar dates ("YYYY-MM-DD", a Postgres `date`), not
 * instants. Every helper here does its arithmetic and formatting in UTC so
 * the result never depends on the runtime's zone; the one zone that matters
 * — the church's, for what "today" is — comes in as `today` from todayIn().
 * Slots are lazy: upcoming dates are computed here and signup rows exist
 * only for covered dates. The schedule falls on Sundays, the rule the
 * signup routes and the reminder function enforce.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const SCHEDULE_WEEKDAY = 0;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Format a Date as YYYY-MM-DD in the runtime's local time (matches Postgres `date`). */
export function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const MAX_WINDOW_WEEKS = 26;

/** The inline error for a "weeks shown" entry, or undefined when it is a whole number from 1 to 26. */
export function windowWeeksError(value: string): string | undefined {
  const weeks = Number(value);
  return value.trim() !== "" && Number.isInteger(weeks) && weeks >= 1 && weeks <= MAX_WINDOW_WEEKS
    ? undefined
    : `Enter a whole number from 1 to ${MAX_WINDOW_WEEKS}.`;
}

/** Today's date in `zone`, "YYYY-MM-DD". */
export function todayIn(zone: string, now: Date = new Date()): string {
  return dayKey(now.toISOString(), zone);
}

/** The next `weeks` schedule dates, starting with `today` when it is one. */
export function upcomingServiceDates(weeks: number, today: string): string[] {
  const start = toMs(today);
  const ahead = (SCHEDULE_WEEKDAY - new Date(start).getUTCDay() + WEEK_DAYS) % WEEK_DAYS;
  const first = start + ahead * DAY_MS;
  return Array.from({ length: Math.max(0, weeks) }, (_, i) =>
    fromMs(first + i * WEEK_DAYS * DAY_MS)
  );
}

/** Every schedule date from `since` (inclusive) to before `today`, newest first. */
export function pastServiceDates(since: string, today: string): string[] {
  const start = toMs(today);
  const back = (new Date(start).getUTCDay() - SCHEDULE_WEEKDAY + WEEK_DAYS) % WEEK_DAYS || WEEK_DAYS;
  const earliest = toMs(since);
  const dates: string[] = [];
  for (let ms = start - back * DAY_MS; ms >= earliest; ms -= WEEK_DAYS * DAY_MS) {
    dates.push(fromMs(ms));
  }
  return dates;
}

/** True for a well-formed schedule date that is `today` or later. */
export function isUpcomingServiceDate(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = toMs(date);
  if (Number.isNaN(ms) || fromMs(ms) !== date) return false;
  return new Date(ms).getUTCDay() === SCHEDULE_WEEKDAY && date >= today;
}

/** Whole days from `today` to `date`; 0 on the day itself. */
export function daysUntil(date: string, today: string): number {
  return Math.round((toMs(date) - toMs(today)) / DAY_MS);
}

/**
 * "Sun, Nov 8", with the year added when it differs from `today`'s, so a
 * date in another year is never mistaken for this one.
 */
export function formatServingDate(date: string, today?: string): string {
  const withYear = today !== undefined && date.slice(0, 4) !== today.slice(0, 4);
  return new Date(toMs(date)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "Sunday, July 12" — for emails and the dashboard. */
export function formatServiceDate(dateStr: string): string {
  return new Date(toMs(dateStr)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Sunday, July 12, 2026" — when the year matters (emails, ICS text). */
export function formatServiceDateWithYear(dateStr: string): string {
  return new Date(toMs(dateStr)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type StatsRange = "thisYear" | "lastYear" | "6mo" | "all";

/** The service_date bounds of a stats range, inclusive; null for no bound. */
export function statsRange(
  range: StatsRange,
  today: string
): { start: string | null; end: string | null } {
  const year = Number(today.slice(0, 4));
  if (range === "thisYear") return { start: `${year}-01-01`, end: `${year}-12-31` };
  if (range === "lastYear") return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  if (range === "6mo") {
    const start = DateTime.fromISO(today, { zone: "UTC" }).minus({ months: 6 }).toISODate();
    return { start, end: today };
  }
  return { start: null, end: null };
}
