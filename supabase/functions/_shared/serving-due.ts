// Which teams the hourly serving reminder job sends for at a given firing.
// Everything is read in the church's time zone: a team's chosen hour stays
// the same on its clock when the clocks change. lib/serving/reminders.ts
// mirrors the default hour; a test on each side checks they agree.
//
// Deliberately import-free so it can be unit tested offline.

/** The hour a team gets when it has not chosen one. */
export const DEFAULT_SEND_HOUR = 9;
/** The earliest and latest hour a team can choose. */
export const FIRST_SEND_HOUR = 6;
export const LAST_SEND_HOUR = 21;
/** Firings from this local hour on do no serving reminder work; nothing carries over to the next day. */
export const RETRY_UNTIL_HOUR = 22;

export interface LocalClock {
  /** "YYYY-MM-DD" in the church's zone. */
  date: string;
  /** 0 (Sunday) to 6, as reminder_days stores it. */
  weekday: number;
  /** 0 to 23 in the church's zone. */
  hour: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The church's wall clock at `now`. Throws on a zone Intl rejects. */
export function localClock(zone: string, now: Date): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: WEEKDAYS.indexOf(part("weekday")),
    hour: Number(part("hour")),
  };
}

/**
 * Whether any team in a church could be due at this local hour. Decided in
 * memory from the zone alone, so a church outside the window costs no query.
 */
export function orgCanBeDue(clock: LocalClock): boolean {
  return clock.hour >= FIRST_SEND_HOUR && clock.hour < RETRY_UNTIL_HOUR;
}

export interface DueSettings {
  reminder_days: number[];
  send_hour: number | null;
}

/** The hour a team's reminder goes out. */
export function sendHourOf(settings: Pick<DueSettings, "send_hour">): number {
  return settings.send_hour ?? DEFAULT_SEND_HOUR;
}

/**
 * Whether a team is due at this firing: today is one of its reminder days
 * and its hour has come. The pass record, not this rule, keeps it to one
 * send per day: a later firing in the same local day is due again and picks
 * up whatever the first one left.
 */
export function teamIsDue(settings: DueSettings, clock: LocalClock): boolean {
  return (
    orgCanBeDue(clock) &&
    settings.reminder_days.includes(clock.weekday) &&
    clock.hour >= sendHourOf(settings)
  );
}
