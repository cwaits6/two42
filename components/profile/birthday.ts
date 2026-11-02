/** Month options for a date picker; Base UI Select takes them as `items`. */
export const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export interface DateParts {
  month: string;
  day: string;
  year: string;
}

export type BirthdayErrors = Partial<Record<"birth_month" | "birth_day" | "birth_year", string>>;
export type AnniversaryErrors = Partial<
  Record<"anniversary_month" | "anniversary_day" | "anniversary_year", string>
>;

/**
 * A date is optional, but once any part is given the month and day must both
 * be there: the directory places dates by month and day. The year stays
 * optional.
 */
function datePartErrors(
  noun: "birthday" | "anniversary",
  { month, day, year }: DateParts,
  today: Date,
): { month?: string; day?: string; year?: string } {
  const found: { month?: string; day?: string; year?: string } = {};
  if (!month && !day && !year) return found;

  const monthNum = month ? Number(month) : null;
  const dayNum = day ? Number(day) : null;
  const yearNum = year ? Number(year) : null;
  const maxYear = today.getFullYear();
  const yearValid =
    yearNum === null || (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= maxYear);

  const monthValid = monthNum !== null && Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12;
  if (!monthValid) found.month = `Choose the month of the ${noun}.`;
  if (dayNum === null) {
    found.day = `Enter the day of the ${noun}.`;
  } else {
    // Without a usable year, leap year 2000 keeps Feb 29 allowed.
    const maxDay = monthValid
      ? new Date(yearValid && yearNum !== null ? yearNum : 2000, monthNum, 0).getDate()
      : 31;
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > maxDay) {
      found.day = `Enter a day from 1 to ${maxDay}.`;
    }
  }
  if (!yearValid) {
    found.year = `Enter a year from 1900 to ${maxYear}, or leave it blank.`;
  }
  return found;
}

export function birthdayErrors(parts: DateParts, today: Date = new Date()): BirthdayErrors {
  const found = datePartErrors("birthday", parts, today);
  const errors: BirthdayErrors = {};
  if (found.month) errors.birth_month = found.month;
  if (found.day) errors.birth_day = found.day;
  if (found.year) errors.birth_year = found.year;
  return errors;
}

export function anniversaryErrors(parts: DateParts, today: Date = new Date()): AnniversaryErrors {
  const found = datePartErrors("anniversary", parts, today);
  const errors: AnniversaryErrors = {};
  if (found.month) errors.anniversary_month = found.month;
  if (found.day) errors.anniversary_day = found.day;
  if (found.year) errors.anniversary_year = found.year;
  return errors;
}

/** The stored columns for a birthday that passed `birthdayErrors`. */
export function birthdayColumns({ month, day, year }: DateParts) {
  return {
    birth_month: month ? Number(month) : null,
    birth_day: day ? Number(day) : null,
    birth_year: year ? Number(year) : null,
  };
}

/** The stored columns for an anniversary that passed `anniversaryErrors`. */
export function anniversaryColumns({ month, day, year }: DateParts) {
  return {
    anniversary_month: month ? Number(month) : null,
    anniversary_day: day ? Number(day) : null,
    anniversary_year: year ? Number(year) : null,
  };
}
