import { DateTime } from "luxon";
import { dayKey } from "@/lib/time/zone";

/**
 * Serving dates are calendar dates ("YYYY-MM-DD", a Postgres `date`), not
 * instants. Every helper here does its arithmetic and formatting in UTC so
 * the result never depends on the runtime's zone; the one zone that matters
 * — the church's, for what "today" is — comes in as `today` from todayIn().
 * Slots are lazy: upcoming dates are computed here and signup rows exist
 * only for covered dates. The schedule falls on Sundays. The signup routes
 * and the reminder function both read "today" in the church's zone.
 * supabase/functions/_shared/serving-dates.ts mirrors what the function needs.
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

export const MAX_WINDOW_WEEKS = 26;
/** How many following weeks a sign-up can offer in one go. */
export const MAX_EXTRA_WEEKS = 3;
/** The longest set block, From to To. */
export const MAX_BLOCK_YEARS = 1;

/** The columns that decide a team's dates. Rolling has no block; set has one. */
export interface TeamDatesSettings {
  schedule: "rolling" | "set";
  window_weeks: number;
  date_from: string | null;
  date_to: string | null;
}

/**
 * What a sign-up path reads from serving_team_settings: the date columns
 * above plus whether signups are on and how many more weeks to offer. One
 * string, so a column the date rule needs cannot be dropped from one reader.
 */
export const SIGNUP_SETTINGS_SELECT = "enabled, schedule, window_weeks, date_from, date_to, extra_weeks";

/** What a team without a settings row shows: the next 8 Sundays. */
export const DEFAULT_TEAM_DATES: TeamDatesSettings = {
  schedule: "rolling",
  window_weeks: 8,
  date_from: null,
  date_to: null,
};

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

/** Every schedule date from `from` to `to`, both inclusive. */
export function serviceDatesBetween(from: string, to: string): string[] {
  const first = toMs(upcomingServiceDates(1, from)[0]);
  const last = toMs(to);
  const dates: string[] = [];
  for (let ms = first; ms <= last; ms += WEEK_DAYS * DAY_MS) dates.push(fromMs(ms));
  return dates;
}

/**
 * The team's dates from `today` on: the rolling window, or what is left of
 * the set block. Every reader of a team's dates goes through here, and
 * supabase/functions/_shared/serving-dates.ts mirrors it.
 */
export function teamServiceDates(settings: TeamDatesSettings, today: string): string[] {
  if (settings.schedule === "set" && settings.date_from && settings.date_to) {
    return serviceDatesBetween(settings.date_from > today ? settings.date_from : today, settings.date_to);
  }
  return upcomingServiceDates(settings.window_weeks, today);
}

/** "30 Sundays" — how many dates a block covers. */
export function sundaysLabel(from: string, to: string): string {
  const n = serviceDatesBetween(from, to).length;
  return n === 1 ? "1 Sunday" : `${n} Sundays`;
}

/** The inline error for a set block, or undefined when To is after From and within a year. */
export function blockError(from: string, to: string): string | undefined {
  if (!from || !to) return "Choose a From date and a To date.";
  if (to <= from) return "Choose a To date after the From date.";
  const limit = DateTime.fromISO(from, { zone: "UTC" }).plus({ years: MAX_BLOCK_YEARS }).toISODate();
  return limit && to > limit ? "Set dates can cover up to a year." : undefined;
}

/**
 * The open dates directly after `date` in the team's dates, up to `count`,
 * stopping at the first taken one: a run of weeks in a row, never a gap.
 */
export function openDatesAfter(
  date: string,
  dates: string[],
  isOpen: (date: string) => boolean,
  count: number
): string[] {
  const start = dates.indexOf(date);
  if (start === -1) return [];
  const offered: string[] = [];
  for (const next of dates.slice(start + 1, start + 1 + count)) {
    if (!isOpen(next)) break;
    offered.push(next);
  }
  return offered;
}

/** "18 open dates through May 2", under the schedule's title. */
export function openDatesLine(dates: string[], isOpen: (date: string) => boolean, today: string): string {
  const last = dates.at(-1);
  if (!last) return "No dates to sign up for";
  const open = dates.filter(isOpen).length;
  const through = formatMonthDay(last, today);
  if (open === 0) return `Every date through ${through} is taken`;
  return `${open} open date${open === 1 ? "" : "s"} through ${through}`;
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

/** "May 2", with the year added when it differs from `today`'s. */
export function formatMonthDay(date: string, today?: string): string {
  const withYear = today !== undefined && date.slice(0, 4) !== today.slice(0, 4);
  return new Date(toMs(date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "November", with the year added when it differs from `today`'s: the heading of a month's card. */
export function formatMonth(date: string, today?: string): string {
  const withYear = today !== undefined && date.slice(0, 4) !== today.slice(0, 4);
  return new Date(toMs(date)).toLocaleDateString("en-US", {
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "Nov 22", "Nov 22 and Nov 29", "Nov 22, Nov 29 and Dec 6". */
export function listDates(dates: string[], format: (date: string) => string): string {
  const labels = dates.map(format);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
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
