// Shared by the member lesson pages and the leader's lesson settings, so a
// lesson reads the same date and part number everywhere it appears.

// A lesson date is a calendar date with no time of day. Reading it as UTC
// midnight and formatting in UTC keeps it the same day on every server.
function utcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** "June 7, 2026" (long) or "Jun 7, 2026" (short). */
export function formatLessonDate(date: string, style: "long" | "short" = "short"): string {
  return utcDate(date).toLocaleDateString("en-US", {
    month: style,
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonthYear(date: string): string {
  return utcDate(date).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

type DatedLesson = { id: string; lecture_date: string | null };

/** Oldest first; undated lessons keep their order after the dated ones. */
export function lessonsInOrder<T extends DatedLesson>(lessons: readonly T[]): T[] {
  return [...lessons].sort((a, b) => {
    if (a.lecture_date === b.lecture_date) return 0;
    if (a.lecture_date === null) return 1;
    if (b.lecture_date === null) return -1;
    return a.lecture_date < b.lecture_date ? -1 : 1;
  });
}

/** Each lesson's part number within its series: 1 for the oldest. */
export function partNumbers(
  lessons: readonly (DatedLesson & { series_id: string | null })[]
): Map<string, number> {
  const parts = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const lesson of lessonsInOrder(lessons)) {
    if (!lesson.series_id) continue;
    const part = (counts.get(lesson.series_id) ?? 0) + 1;
    counts.set(lesson.series_id, part);
    parts.set(lesson.id, part);
  }
  return parts;
}

/** "May 2026 – present" while the series is current; its first to last month once it is past. */
export function seriesDateRange(
  lessons: readonly DatedLesson[],
  isPast: boolean
): string | null {
  const dated = lessonsInOrder(lessons).filter((l) => l.lecture_date !== null);
  if (dated.length === 0) return null;
  const start = formatMonthYear(dated[0].lecture_date!);
  if (!isPast) return `${start} – present`;
  const end = formatMonthYear(dated[dated.length - 1].lecture_date!);
  return end === start ? start : `${start} – ${end}`;
}

export function needsSummary(summary: string | null): boolean {
  return !summary || summary.trim() === "";
}

/** The URL when it is http(s), otherwise null: stored links reach href and src. */
export function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function youTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?\s]+)/
  );
  return match ? match[1] : null;
}

/** The lesson's own thumbnail, else YouTube's for a YouTube recording. */
export function lessonThumbnail(lesson: {
  video_url: string;
  thumbnail_url: string | null;
}): string | null {
  const own = safeHttpUrl(lesson.thumbnail_url);
  if (own) return own;
  const video = safeHttpUrl(lesson.video_url);
  const id = video ? youTubeId(video) : null;
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
