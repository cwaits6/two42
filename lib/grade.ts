/**
 * A child's school grade, worked out from their expected high-school
 * graduation year so it moves up each school year with no edit. `today` is
 * the church's calendar date as a local-midnight Date.
 */

export const KINDERGARTEN = 0;
export const LAST_GRADE = 12;

/** Grade 0 is kindergarten. */
export const GRADES: readonly number[] = Array.from({ length: LAST_GRADE + 1 }, (_, i) => i);

const ROLLOVER_MONTH = 7; // August, zero-based: a school year runs 1 August to 31 July.

/** The calendar year the current school year ends in. */
export function schoolYearEnd(today: Date): number {
  const year = today.getFullYear();
  return today.getMonth() >= ROLLOVER_MONTH ? year + 1 : year;
}

/** The grade for a graduation year, or null before kindergarten or after 12th grade. */
export function gradeFor(graduationYear: number | null | undefined, today: Date): number | null {
  if (graduationYear == null || !Number.isInteger(graduationYear)) return null;
  const grade = LAST_GRADE - (graduationYear - schoolYearEnd(today));
  return grade >= KINDERGARTEN && grade <= LAST_GRADE ? grade : null;
}

export function graduationYearFor(grade: number, today: Date): number {
  return schoolYearEnd(today) + (LAST_GRADE - grade);
}

function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Kindergarten", "1st grade" … "12th grade". */
export function gradeLabel(grade: number): string {
  return grade === KINDERGARTEN ? "Kindergarten" : `${ordinal(grade)} grade`;
}

/** The grade shown beside a child, or null for anyone else or a year out of range. */
export function childGradeLabel(
  person: { relationship: string; graduation_year?: number | null },
  today: Date,
): string | null {
  if (person.relationship !== "child") return null;
  const grade = gradeFor(person.graduation_year, today);
  return grade === null ? null : gradeLabel(grade);
}

export const MIN_GRADUATION_YEAR = 2000;
export const MAX_GRADUATION_YEAR = 2100;

/**
 * A graduation year from a request body: the year, null to clear it, or
 * undefined when the value is not a whole year in range.
 */
export function parseGraduationYear(raw: unknown): number | null | undefined {
  if (raw === null || raw === "") return null;
  const year = typeof raw === "string" ? Number(raw) : raw;
  if (typeof year !== "number" || !Number.isInteger(year)) return undefined;
  return year >= MIN_GRADUATION_YEAR && year <= MAX_GRADUATION_YEAR ? year : undefined;
}
