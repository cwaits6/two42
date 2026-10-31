import { describe, expect, it } from "vitest";
import {
  formatLessonDate,
  lessonThumbnail,
  lessonsInOrder,
  needsSummary,
  partNumbers,
  safeHttpUrl,
  seriesDateRange,
} from "./lessons";

describe("formatLessonDate", () => {
  it("shows the calendar date with no weekday", () => {
    expect(formatLessonDate("2026-06-07")).toBe("Jun 7, 2026");
    expect(formatLessonDate("2026-06-07", "long")).toBe("June 7, 2026");
  });

  it("keeps the stored day whatever the server's time zone", () => {
    expect(formatLessonDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatLessonDate("2026-12-31")).toBe("Dec 31, 2026");
  });
});

describe("lessonsInOrder", () => {
  it("puts the oldest first and undated lessons last in their given order", () => {
    const ordered = lessonsInOrder([
      { id: "undated-a", lecture_date: null },
      { id: "june", lecture_date: "2026-06-07" },
      { id: "undated-b", lecture_date: null },
      { id: "may", lecture_date: "2026-05-31" },
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["may", "june", "undated-a", "undated-b"]);
  });
});

describe("partNumbers", () => {
  it("numbers each series from 1 by date and skips lessons with no series", () => {
    const parts = partNumbers([
      { id: "a2", series_id: "a", lecture_date: "2026-06-14" },
      { id: "b1", series_id: "b", lecture_date: "2026-06-21" },
      { id: "a1", series_id: "a", lecture_date: "2026-06-07" },
      { id: "solo", series_id: null, lecture_date: "2026-06-01" },
      { id: "a3", series_id: "a", lecture_date: null },
    ]);
    expect(Object.fromEntries(parts)).toEqual({ a1: 1, a2: 2, a3: 3, b1: 1 });
  });
});

describe("seriesDateRange", () => {
  const lessons = [
    { id: "1", lecture_date: "2026-05-31" },
    { id: "2", lecture_date: "2026-07-05" },
    { id: "3", lecture_date: null },
  ];

  it("runs to the present while the series is current", () => {
    expect(seriesDateRange(lessons, false)).toBe("May 2026 – present");
  });

  it("spans first to last month once the series is past", () => {
    expect(seriesDateRange(lessons, true)).toBe("May 2026 – Jul 2026");
    expect(seriesDateRange([lessons[0]], true)).toBe("May 2026");
  });

  it("is absent when no lesson has a date", () => {
    expect(seriesDateRange([{ id: "1", lecture_date: null }], false)).toBeNull();
  });
});

describe("needsSummary", () => {
  it("treats a blank summary as missing", () => {
    expect(needsSummary(null)).toBe(true);
    expect(needsSummary("  \n")).toBe(true);
    expect(needsSummary("We read Romans 8.")).toBe(false);
  });
});

describe("safeHttpUrl", () => {
  it("passes http and https links and refuses anything else", () => {
    expect(safeHttpUrl("https://example.test/a")).toBe("https://example.test/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("not a link")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("lessonThumbnail", () => {
  it("prefers the lesson's own thumbnail", () => {
    expect(
      lessonThumbnail({
        video_url: "https://youtu.be/abc123",
        thumbnail_url: "https://example.test/t.jpg",
      }),
    ).toBe("https://example.test/t.jpg");
  });

  it("falls back to YouTube's for a YouTube recording", () => {
    expect(
      lessonThumbnail({ video_url: "https://www.youtube.com/watch?v=abc123", thumbnail_url: null }),
    ).toBe("https://img.youtube.com/vi/abc123/hqdefault.jpg");
  });

  it("has none for other recordings or an unsafe thumbnail", () => {
    expect(lessonThumbnail({ video_url: "https://zoom.us/rec/1", thumbnail_url: null })).toBeNull();
    expect(
      lessonThumbnail({ video_url: "https://zoom.us/rec/1", thumbnail_url: "javascript:x" }),
    ).toBeNull();
  });
});
