// Serving dates for the reminder flows, mirroring lib/serving/dates.ts, which
// cannot be imported here (Luxon, "@/" aliases). A serving date is a calendar
// date ("YYYY-MM-DD"), so the arithmetic and formatting run in UTC.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const SCHEDULE_WEEKDAY = 0;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Today's date in `zone`, "YYYY-MM-DD". Throws on a zone Intl rejects. */
export function todayIn(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The date's weekday as serving_team_settings.reminder_days stores it, 0 to 6. */
export function weekdayOf(date: string): number {
  return new Date(toMs(date)).getUTCDay();
}

/** The next `weeks` schedule dates, starting with `today` when it is one. */
export function upcomingServiceDates(weeks: number, today: string): string[] {
  const ahead = (SCHEDULE_WEEKDAY - weekdayOf(today) + WEEK_DAYS) % WEEK_DAYS;
  const first = toMs(today) + ahead * DAY_MS;
  return Array.from({ length: Math.max(0, weeks) }, (_, i) =>
    new Date(first + i * WEEK_DAYS * DAY_MS).toISOString().slice(0, 10)
  );
}

/**
 * The date a reminder run acts on: the church's, but never behind UTC's. The
 * jobs fire once a day at 08:00 UTC, which is the previous evening west of
 * UTC-8. There the church's own date would send a Sunday reminder after that
 * Sunday's service, and in Alaska, where daylight saving moves the run across
 * midnight, repeat one date and skip another. The hold can go if the schedule
 * moves to an hour where no zone crosses midnight, such as 15:00 UTC.
 */
export function reminderRun(org: { timezone: string }, now: Date = new Date()) {
  const churchDate = todayIn(org.timezone, now);
  const utcDate = now.toISOString().slice(0, 10);
  const today = churchDate > utcDate ? churchDate : utcDate;
  return {
    today,
    weekday: weekdayOf(today),
    serviceDate: upcomingServiceDates(1, today)[0],
  };
}

/** "Sunday, July 12, 2026". */
export function formatServiceDateWithYear(date: string): string {
  return new Date(toMs(date)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
