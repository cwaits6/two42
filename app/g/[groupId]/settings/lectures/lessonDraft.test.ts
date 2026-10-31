import { describe, expect, it } from "vitest";
import {
  NO_SERIES,
  emptyLessonDraft,
  lessonColumns,
  lessonDraftFrom,
  seriesColumns,
  seriesItems,
  validateLesson,
  validateSeries,
  withAddedSeries,
  type LessonDraft,
} from "./lessonDraft";

const romans = { id: "s1", name: "Romans", teacher: "Dean Rosson" };
const acts = { id: "s2", name: "Acts", teacher: null };

const typed: LessonDraft = {
  series_id: NO_SERIES,
  title: "Life in the Spirit",
  video_url: "https://youtu.be/abc123",
  lecture_date: "2026-06-07",
  description: "Romans 8",
  summary: "We read Romans 8 together.",
  thumbnail_url: "",
};

describe("withAddedSeries", () => {
  it("selects the new series and keeps every typed field", () => {
    const after = withAddedSeries({ draft: typed, series: [romans] }, acts);
    expect(after.draft).toEqual({ ...typed, series_id: "s2" });
    expect(after.series).toEqual([acts, romans]);
  });

  it("does not list a series twice", () => {
    const after = withAddedSeries({ draft: typed, series: [acts, romans] }, acts);
    expect(after.series).toEqual([acts, romans]);
  });
});

describe("emptyLessonDraft", () => {
  it("starts on the series the page was opened for", () => {
    expect(emptyLessonDraft([romans], "s1").series_id).toBe("s1");
  });

  it("starts on no series when the requested one is not this group's", () => {
    expect(emptyLessonDraft([romans], "other").series_id).toBe(NO_SERIES);
    expect(emptyLessonDraft([romans]).series_id).toBe(NO_SERIES);
  });
});

describe("validateLesson", () => {
  it("accepts a complete lesson", () => {
    expect(validateLesson(typed)).toEqual({});
  });

  it("asks for a title and a recording link, in field order", () => {
    const errors = validateLesson({ ...typed, title: " ", video_url: "" });
    expect(Object.keys(errors)).toEqual(["title", "video_url"]);
    expect(errors.title).toBe("Enter a title.");
    expect(errors.video_url).toBe("Enter a link to the recording.");
  });

  it("refuses links that are not http or https", () => {
    const errors = validateLesson({
      ...typed,
      video_url: "youtu.be/abc",
      thumbnail_url: "javascript:x",
    });
    expect(errors.video_url).toBe("Enter a link that starts with https://");
    expect(errors.thumbnail_url).toBe("Enter an image link that starts with https://");
  });
});

describe("lessonColumns", () => {
  it("stores empty optional fields and no series as null", () => {
    expect(
      lessonColumns({
        ...typed,
        title: "  Life in the Spirit ",
        lecture_date: "",
        description: " ",
        summary: "",
      }),
    ).toEqual({
      series_id: null,
      title: "Life in the Spirit",
      video_url: "https://youtu.be/abc123",
      lecture_date: null,
      description: null,
      summary: null,
      thumbnail_url: null,
    });
  });

  it("round-trips a saved lesson through the form", () => {
    const saved = { ...lessonColumns({ ...typed, series_id: "s1" }) };
    expect(lessonColumns(lessonDraftFrom(saved))).toEqual(saved);
  });
});

describe("seriesItems", () => {
  it("offers no series first and names each series' teacher", () => {
    expect(seriesItems([romans, acts])).toEqual([
      { value: NO_SERIES, label: "No series" },
      { value: "s1", label: "Romans · Dean Rosson" },
      { value: "s2", label: "Acts" },
    ]);
  });
});

describe("series fields", () => {
  it("asks for a name", () => {
    expect(validateSeries({ name: " ", teacher: "" })).toEqual({ name: "Enter a series name." });
    expect(validateSeries({ name: "Acts", teacher: "" })).toEqual({});
  });

  it("stores a blank teacher as null", () => {
    expect(seriesColumns({ name: " Acts ", teacher: " " })).toEqual({ name: "Acts", teacher: null });
  });
});
