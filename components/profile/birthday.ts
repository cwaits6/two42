/** Month options for a birthday picker; Base UI Select takes them as `items`. */
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

export interface BirthdayInput {
  month: string;
  day: string;
  year: string;
}

export type BirthdayErrors = Partial<Record<"birth_month" | "birth_day" | "birth_year", string>>;

/**
 * A birthday is optional, but once any part is given the month and day must
 * both be there: the directory lists birthdays by month and day.
 */
export function birthdayErrors(
  { month, day, year }: BirthdayInput,
  today: Date = new Date(),
): BirthdayErrors {
  const found: BirthdayErrors = {};
  if (!month && !day && !year) return found;

  const monthNum = month ? Number(month) : null;
  const dayNum = day ? Number(day) : null;
  const yearNum = year ? Number(year) : null;
  const maxYear = today.getFullYear();
  const yearValid =
    yearNum === null || (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= maxYear);

  if (!monthNum) found.birth_month = "Choose the month of the birthday.";
  if (dayNum === null) {
    found.birth_day = "Enter the day of the birthday.";
  } else {
    // Without a usable year, leap year 2000 keeps Feb 29 allowed.
    const maxDay = monthNum
      ? new Date(yearValid && yearNum !== null ? yearNum : 2000, monthNum, 0).getDate()
      : 31;
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > maxDay) {
      found.birth_day = `Enter a day from 1 to ${maxDay}.`;
    }
  }
  if (!yearValid) {
    found.birth_year = `Enter a year from 1900 to ${maxYear}, or leave it blank.`;
  }
  return found;
}

/** The stored columns for a birthday that passed `birthdayErrors`. */
export function birthdayColumns({ month, day, year }: BirthdayInput) {
  return {
    birth_month: month ? Number(month) : null,
    birth_day: day ? Number(day) : null,
    birth_year: year ? Number(year) : null,
  };
}
