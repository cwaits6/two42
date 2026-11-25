// Dinner dates from a season's start, end and how often. Pure: dates are
// "YYYY-MM-DD" strings, read as calendar days with no zone; the caller turns
// each proposed wall-clock time into an instant in the church's zone.

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

function addDays(day: string, n: number): string {
  return toDay(new Date(toUTC(day).getTime() + n * DAY_MS));
}

/** The day `months` months on, kept to the last day of a shorter month. */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toDay(target);
}

/** The last day of a season that runs `months` months from `startsOn`. */
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

/** Each dinner's local start, "YYYY-MM-DDTHH:mm", in date order. */
export function proposeDinnerDates(rule: DateRule): string[] {
  const days: string[] = [];
  if (rule.endsOn < rule.startsOn) return days;

  if (rule.repeat.kind === "weeks") {
    const step = Math.max(1, Math.floor(rule.repeat.everyWeeks)) * 7;
    const start = toUTC(rule.startsOn);
    let day = addDays(rule.startsOn, (rule.weekday - start.getUTCDay() + 7) % 7);
    while (day <= rule.endsOn) {
      days.push(day);
      day = addDays(day, step);
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
