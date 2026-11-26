const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DASH = " – ";

type Month = { year: number; month: number };

function monthOf(day: string): Month | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const [year, month, date] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  return { year, month: month - 1 };
}

/** Spring, summer, fall or winter, with winter named for its December's year. */
function partOfYear({ year, month }: Month): string {
  if (month >= 2 && month <= 4) return `Spring ${year}`;
  if (month >= 5 && month <= 7) return `Summer ${year}`;
  if (month >= 8 && month <= 10) return `Fall ${year}`;
  return `Winter ${month === 11 ? year : year - 1}`;
}

function monthRange(start: Month, end: Month): string {
  if (start.year !== end.year) return `${MONTHS[start.month]} ${start.year}${DASH}${MONTHS[end.month]} ${end.year}`;
  if (start.month === end.month) return `${MONTHS[start.month]} ${start.year}`;
  return `${MONTHS[start.month]}${DASH}${MONTHS[end.month]} ${start.year}`;
}

/**
 * A rotation's title from its dates (YYYY-MM-DD): the part of the year when
 * both dates fall in the same one, else the month range. A title another
 * rotation of the group already has falls back to the month range, then
 * numbers it. Empty when the dates are missing or the end is before the start.
 */
export function rotationTitle(startsOn: string, endsOn: string, takenTitles: readonly string[]): string {
  const start = monthOf(startsOn);
  const end = monthOf(endsOn);
  if (!start || !end || endsOn < startsOn) return "";
  const taken = new Set(takenTitles.map((t) => t.trim().toLowerCase()));
  const free = (title: string) => !taken.has(title.toLowerCase());
  const range = monthRange(start, end);
  const part = partOfYear(start);
  if (part === partOfYear(end) && free(part)) return part;
  if (free(range)) return range;
  for (let n = 2; ; n++) {
    if (free(`${range} (${n})`)) return `${range} (${n})`;
  }
}
