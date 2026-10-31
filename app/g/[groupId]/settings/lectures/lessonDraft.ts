import { safeHttpUrl } from "@/lib/lessons";

export const NO_SERIES = "none";

export type SeriesOption = { id: string; name: string; teacher: string | null };

/** The lesson form's fields, as typed. Keys match the field ids. */
export type LessonDraft = {
  series_id: string;
  title: string;
  video_url: string;
  lecture_date: string;
  description: string;
  summary: string;
  thumbnail_url: string;
};

export type LessonFieldErrors = Partial<Record<"title" | "video_url" | "thumbnail_url", string>>;

export type SeriesDraft = { name: string; teacher: string };

export type SeriesFieldErrors = Partial<Record<"name", string>>;

/** A preselected series that is not in the list starts the form on no series. */
export function emptyLessonDraft(
  series: readonly SeriesOption[],
  preselected?: string
): LessonDraft {
  return {
    series_id: series.some((s) => s.id === preselected) ? preselected! : NO_SERIES,
    title: "",
    video_url: "",
    lecture_date: "",
    description: "",
    summary: "",
    thumbnail_url: "",
  };
}

export function lessonDraftFrom(lesson: {
  series_id: string | null;
  title: string;
  video_url: string;
  lecture_date: string | null;
  description: string | null;
  summary: string | null;
  thumbnail_url: string | null;
}): LessonDraft {
  return {
    series_id: lesson.series_id ?? NO_SERIES,
    title: lesson.title,
    video_url: lesson.video_url,
    lecture_date: lesson.lecture_date ?? "",
    description: lesson.description ?? "",
    summary: lesson.summary ?? "",
    thumbnail_url: lesson.thumbnail_url ?? "",
  };
}

/** In field order, so the first key is the field focus moves to. */
export function validateLesson(draft: LessonDraft): LessonFieldErrors {
  const errors: LessonFieldErrors = {};
  if (!draft.title.trim()) errors.title = "Enter a title.";
  const video = draft.video_url.trim();
  if (!video) errors.video_url = "Enter a link to the recording.";
  else if (!safeHttpUrl(video)) errors.video_url = "Enter a link that starts with https://";
  const thumbnail = draft.thumbnail_url.trim();
  if (thumbnail && !safeHttpUrl(thumbnail)) {
    errors.thumbnail_url = "Enter an image link that starts with https://";
  }
  return errors;
}

/** The columns a save writes. Empty optional fields are stored as null. */
export function lessonColumns(draft: LessonDraft) {
  const orNull = (value: string) => value.trim() || null;
  return {
    series_id: draft.series_id === NO_SERIES ? null : draft.series_id,
    title: draft.title.trim(),
    video_url: draft.video_url.trim(),
    lecture_date: draft.lecture_date || null,
    description: orNull(draft.description),
    summary: orNull(draft.summary),
    thumbnail_url: orNull(draft.thumbnail_url),
  };
}

/**
 * The form after a series is added from it: the new series is listed and
 * selected, and everything already typed stays.
 */
export function withAddedSeries(
  form: { draft: LessonDraft; series: readonly SeriesOption[] },
  added: SeriesOption
): { draft: LessonDraft; series: SeriesOption[] } {
  return {
    draft: { ...form.draft, series_id: added.id },
    series: [added, ...form.series.filter((s) => s.id !== added.id)],
  };
}

export function seriesItems(series: readonly SeriesOption[]) {
  return [
    { value: NO_SERIES, label: "No series" },
    ...series.map((s) => ({
      value: s.id,
      label: s.teacher ? `${s.name} · ${s.teacher}` : s.name,
    })),
  ];
}

export function validateSeries(draft: SeriesDraft): SeriesFieldErrors {
  return draft.name.trim() ? {} : { name: "Enter a series name." };
}

export function seriesColumns(draft: SeriesDraft) {
  return { name: draft.name.trim(), teacher: draft.teacher.trim() || null };
}
