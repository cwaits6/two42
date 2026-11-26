// Supper dates from a rotation's start, end and how often. Pure: dates are
// "YYYY-MM-DD" strings, read as calendar days with no zone, until
// rotationDateStarts() reads each wall-clock time in the church's zone.

import { localToUTCISO } from "@/lib/time/zone";

export type RepeatRule =
  | { kind: "weeks"; everyWeeks: number }
  /** weekOfMonth 1 to 4, or 5 for the last such weekday of the month. */
  | { kind: "monthly_weekday"; weekOfMonth: number };

export interface DateRule {
  startsOn: string;
  endsOn: string;
  repeat: RepeatRule;
  /** 0 is Sunday. */
  weekday: number;
  /** "HH:mm" */
  startTime: string;
}

const DAY_MS = 86_400_000;

function toUTC(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return toDay(new Date(toUTC(day).getTime() + n * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / DAY_MS);
}

/** The day `months` months on, kept to the last day of a shorter month. */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toDay(target);
}

/** The last day of a rotation that runs `months` months from `startsOn`. */
export function endFromMonths(startsOn: string, months: number): string {
  return addDays(addMonths(startsOn, months), -1);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, weekOfMonth: number): string | null {
  if (weekOfMonth === 5) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const back = (last.getUTCDay() - weekday + 7) % 7;
    return toDay(new Date(last.getTime() - back * DAY_MS));
  }
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  const candidate = new Date(Date.UTC(year, month, day));
  return candidate.getUTCMonth() === month ? toDay(candidate) : null;
}

/** Each supper's local start, "YYYY-MM-DDTHH:mm", in date order. */
export function proposeSupperDates(rule: DateRule): string[] {
  const days: string[] = [];
  if (rule.endsOn < rule.startsOn) return days;

  if (rule.repeat.kind === "weeks") {
    const step = Math.max(1, Math.floor(rule.repeat.everyWeeks)) * 7;
    const start = toUTC(rule.startsOn);
    const end = toUTC(rule.endsOn).getTime();
    // Compared as times, not strings: a day past year 9999 formats as
    // "+010000-…", which sorts before the end date.
    let time = start.getTime() + ((rule.weekday - start.getUTCDay() + 7) % 7) * DAY_MS;
    while (time <= end) {
      days.push(toDay(new Date(time)));
      time += step * DAY_MS;
    }
  } else {
    const start = toUTC(rule.startsOn);
    const end = toUTC(rule.endsOn);
    let year = start.getUTCFullYear();
    let month = start.getUTCMonth();
    while (year < end.getUTCFullYear() || (year === end.getUTCFullYear() && month <= end.getUTCMonth())) {
      const day = nthWeekdayOfMonth(year, month, rule.weekday, rule.repeat.weekOfMonth);
      if (day && day >= rule.startsOn && day <= rule.endsOn) days.push(day);
      month += 1;
      if (month === 12) {
        month = 0;
        year += 1;
      }
    }
  }
  return days.map((day) => `${day}T${rule.startTime}`);
}

/** A rotation's proposed supper dates, as instants in the church's zone. */
export function rotationDateStarts(
  rotation: {
    starts_on: string;
    ends_on: string;
    repeat_kind: string;
    repeat_weeks: number | null;
    repeat_week_of_month: number | null;
    weekday: number;
    default_start_time: string;
  },
  zone: string
): string[] {
  return proposeSupperDates({
    startsOn: rotation.starts_on,
    endsOn: rotation.ends_on,
    repeat:
      rotation.repeat_kind === "monthly_weekday"
        ? { kind: "monthly_weekday", weekOfMonth: rotation.repeat_week_of_month ?? 1 }
        : { kind: "weeks", everyWeeks: rotation.repeat_weeks ?? 1 },
    weekday: rotation.weekday,
    startTime: rotation.default_start_time.slice(0, 5),
  }).map((local) => localToUTCISO(local, zone));
}
