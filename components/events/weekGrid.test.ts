import { describe, expect, it } from "vitest";
import {
  GRID_MINUTES,
  HOUR_HEIGHT_PX,
  MIN_BLOCK_PX,
  addDays,
  dayKey,
  formatDayTime,
  formatHour,
  gridHours,
  layoutLanes,
  localeWeekStart,
  placeEvent,
  placeSegment,
  segmentOn,
  spansDays,
  weekDays,
  weekTitle,
} from "./weekGrid";

// Local-time constructors keep these independent of the machine's zone.
const at = (hour: number, minute = 0) => new Date(2026, 8, 29, hour, minute);

describe("placeEvent", () => {
  it("offsets a start time from 6 am in minutes", () => {
    expect(placeEvent(at(19), at(20, 30))).toEqual({
      kind: "timed",
      topMinutes: 13 * 60,
      durationMinutes: 90,
    });
    expect(placeEvent(at(6), at(7))).toMatchObject({ topMinutes: 0, durationMinutes: 60 });
    expect(placeEvent(at(9, 15), at(10))).toMatchObject({ topMinutes: 195, durationMinutes: 45 });
  });

  it("draws an event without an end as one hour", () => {
    expect(placeEvent(at(12), null)).toMatchObject({ durationMinutes: 60 });
  });

  it("keeps a short event at the minimum block length", () => {
    const minimum = Math.ceil((MIN_BLOCK_PX / HOUR_HEIGHT_PX) * 60);
    expect(minimum).toBe(42);
    expect(placeEvent(at(12), at(12, 15))).toMatchObject({ durationMinutes: minimum });
  });

  it("floors an end before the start to the minimum", () => {
    expect(placeEvent(at(12), at(11))).toMatchObject({
      topMinutes: 6 * 60,
      durationMinutes: 42,
    });
  });

  it("gives a 30-minute block at least the pixel target", () => {
    const placed = placeEvent(at(9), at(9, 30));
    expect(placed.kind === "timed" && (placed.durationMinutes / 60) * HOUR_HEIGHT_PX).toBeGreaterThanOrEqual(
      MIN_BLOCK_PX
    );
  });

  it("clips at 10 pm", () => {
    expect(placeEvent(at(21), at(23, 30))).toMatchObject({
      topMinutes: 15 * 60,
      durationMinutes: 60,
    });
    expect(placeEvent(at(21, 45), null)).toMatchObject({ topMinutes: 918, durationMinutes: 42 });
  });

  it("sends a start before 6 am or at 10 pm or later to the all-day row", () => {
    expect(placeEvent(at(0), at(1))).toEqual({ kind: "allDay" });
    expect(placeEvent(at(5, 59), at(7))).toEqual({ kind: "allDay" });
    expect(placeEvent(at(22), at(23))).toEqual({ kind: "allDay" });
    expect(placeEvent(at(23, 30), null)).toEqual({ kind: "allDay" });
  });

  it("moves a late start up so its minimum block ends at 10 pm", () => {
    for (const late of [at(21, 30), at(21, 59)]) {
      const placed = placeEvent(late, at(22, 30));
      expect(placed).toMatchObject({ kind: "timed", topMinutes: 918, durationMinutes: 42 });
      if (placed.kind !== "timed") continue;
      const bottomPx = ((placed.topMinutes + placed.durationMinutes) / 60) * HOUR_HEIGHT_PX;
      expect(bottomPx).toBe((GRID_MINUTES / 60) * HOUR_HEIGHT_PX);
      expect(((placed.durationMinutes) / 60) * HOUR_HEIGHT_PX).toBeGreaterThanOrEqual(MIN_BLOCK_PX);
    }
  });

  it("does not move a start that already fits", () => {
    expect(placeEvent(at(21, 18), null)).toMatchObject({ topMinutes: 918, durationMinutes: 42 });
    expect(placeEvent(at(21, 17), null)).toMatchObject({ topMinutes: 917, durationMinutes: 43 });
  });
});

describe("segmentOn", () => {
  const day = (date: number) => new Date(2026, 8, date);
  const on = (date: number, hour: number, minute = 0) => new Date(2026, 8, date, hour, minute);

  it("keeps a same-day event whole, on its own day only", () => {
    expect(segmentOn(at(19), at(20, 30), day(29))).toEqual({
      start: at(19),
      end: at(20, 30),
      continuesBefore: false,
      continuesAfter: false,
    });
    expect(segmentOn(at(19), at(20, 30), day(30))).toBeNull();
    expect(segmentOn(at(19), null, day(29))).toMatchObject({ end: null, continuesAfter: false });
    expect(segmentOn(at(19), null, day(30))).toBeNull();
  });

  it("belongs to the start day alone when the end is not after the start", () => {
    expect(segmentOn(at(12), at(11), day(29))).toMatchObject({ end: at(11), continuesAfter: false });
    expect(segmentOn(at(12), at(11), day(28))).toBeNull();
  });

  it("splits an overnight event at local midnight", () => {
    const start = on(29, 19);
    const end = on(30, 1);
    expect(segmentOn(start, end, day(29))).toEqual({
      start,
      end: day(30),
      continuesBefore: false,
      continuesAfter: true,
    });
    expect(segmentOn(start, end, day(30))).toEqual({
      start: day(30),
      end,
      continuesBefore: true,
      continuesAfter: false,
    });
    expect(segmentOn(start, end, day(28))).toBeNull();
    expect(segmentOn(start, end, new Date(2026, 9, 1))).toBeNull();
  });

  it("gives a three-day event a full middle day", () => {
    const start = on(27, 10);
    const end = on(29, 14);
    expect(segmentOn(start, end, day(28))).toEqual({
      start: day(28),
      end: day(29),
      continuesBefore: true,
      continuesAfter: true,
    });
    expect(segmentOn(start, end, day(29))).toMatchObject({ start: day(29), end, continuesBefore: true });
  });

  it("does not reach into the next day when the end is exactly midnight", () => {
    expect(segmentOn(on(29, 19), day(30), day(29))).toMatchObject({ continuesAfter: false });
    expect(segmentOn(on(29, 19), day(30), day(30))).toBeNull();
  });

  it("ignores the day argument's time of day", () => {
    expect(segmentOn(at(19), at(20), new Date(2026, 8, 29, 23, 59))).not.toBeNull();
  });
});

describe("placeSegment", () => {
  const segment = (start: Date, end: Date | null, continuesBefore: boolean, continuesAfter: boolean) => ({
    start,
    end,
    continuesBefore,
    continuesAfter,
  });
  const midnight = new Date(2026, 8, 29);

  it("places a segment that starts today like the event itself", () => {
    expect(placeSegment(segment(at(19), at(20, 30), false, false))).toEqual(placeEvent(at(19), at(20, 30)));
    expect(placeSegment(segment(at(19), new Date(2026, 8, 30), false, true))).toEqual({
      kind: "timed",
      topMinutes: 13 * 60,
      durationMinutes: 3 * 60,
    });
  });

  it("draws a continuation from 6 am to its end", () => {
    expect(placeSegment(segment(midnight, at(14), true, false))).toEqual({
      kind: "timed",
      topMinutes: 0,
      durationMinutes: 8 * 60,
    });
    expect(placeSegment(segment(midnight, at(6, 10), true, false))).toMatchObject({
      topMinutes: 0,
      durationMinutes: 42,
    });
  });

  it("sends a continuation that ends before 6 am to the all-day row", () => {
    expect(placeSegment(segment(midnight, at(1), true, false))).toEqual({ kind: "allDay" });
    expect(placeSegment(segment(midnight, at(6), true, false))).toEqual({ kind: "allDay" });
  });

  it("sends a continuation that covers the whole grid to the all-day row", () => {
    expect(placeSegment(segment(midnight, at(22), true, false))).toEqual({ kind: "allDay" });
    expect(placeSegment(segment(midnight, new Date(2026, 8, 30), true, true))).toEqual({ kind: "allDay" });
  });
});

describe("spansDays", () => {
  it("is true only when the event's last moment is on a later day", () => {
    expect(spansDays(at(19), at(20))).toBe(false);
    expect(spansDays(at(19), null)).toBe(false);
    expect(spansDays(at(19), new Date(2026, 8, 30, 1))).toBe(true);
    expect(spansDays(at(19), new Date(2026, 8, 30))).toBe(false);
    expect(spansDays(at(12), at(11))).toBe(false);
  });
});

describe("formatDayTime", () => {
  it("names the weekday with the time", () => {
    expect(formatDayTime(at(19))).toBe("Tue 7:00 PM");
  });
});

describe("layoutLanes", () => {
  const span = (startHour: number, hours: number) => ({
    topMinutes: startHour * 60,
    durationMinutes: hours * 60,
  });

  it("gives non-overlapping events the full width", () => {
    expect(layoutLanes([span(1, 1), span(2, 1), span(4, 2)])).toEqual([
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
    ]);
  });

  it("does not overlap events that touch end to start", () => {
    expect(layoutLanes([span(1, 1), span(2, 1)])).toEqual([
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 1 },
    ]);
  });

  it("places two overlapping events side by side", () => {
    expect(layoutLanes([span(1, 2), span(2, 2)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
    ]);
  });

  it("shares a cluster's width across a chain of overlaps", () => {
    // A and B overlap, B and C overlap, A and C do not: C reuses A's lane
    // but the cluster is still two wide.
    expect(layoutLanes([span(1, 2), span(2, 2), span(3, 1)])).toEqual([
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
      { lane: 0, laneCount: 2 },
    ]);
  });

  it("widens to three lanes when three events share a time", () => {
    expect(layoutLanes([span(1, 3), span(1, 1), span(1, 2)])).toEqual([
      { lane: 0, laneCount: 3 },
      { lane: 2, laneCount: 3 },
      { lane: 1, laneCount: 3 },
    ]);
  });

  it("keeps separate clusters at their own widths and the input order", () => {
    expect(layoutLanes([span(5, 1), span(1, 1), span(1, 1)])).toEqual([
      { lane: 0, laneCount: 1 },
      { lane: 0, laneCount: 2 },
      { lane: 1, laneCount: 2 },
    ]);
  });

  it("handles an empty column", () => {
    expect(layoutLanes([])).toEqual([]);
  });
});

describe("weekDays", () => {
  const tuesday = new Date(2026, 8, 29, 15, 42);

  it("starts on Sunday for a Sunday-first locale", () => {
    const days = weekDays(tuesday, 0);
    expect(days.map(dayKey)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(days.every((d) => d.getHours() === 0 && d.getMinutes() === 0)).toBe(true);
  });

  it("starts on Monday for a Monday-first locale", () => {
    expect(weekDays(tuesday, 1).map(dayKey)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("starts on Saturday for a Saturday-first locale", () => {
    expect(weekDays(tuesday, 6).map(dayKey)[0]).toBe("2026-09-26");
    expect(weekDays(new Date(2026, 8, 26), 6).map(dayKey)[0]).toBe("2026-09-26");
  });

  it("keeps the anchor's own day when it is the first day", () => {
    expect(weekDays(new Date(2026, 8, 27), 0).map(dayKey)[0]).toBe("2026-09-27");
    expect(weekDays(new Date(2026, 8, 28), 1).map(dayKey)[0]).toBe("2026-09-28");
  });
});

describe("localeWeekStart", () => {
  it("maps Intl week info onto Sunday = 0", () => {
    expect(localeWeekStart("en-US")).toBe(0);
    expect(localeWeekStart("en-GB")).toBe(1);
    expect(localeWeekStart("de-DE")).toBe(1);
  });

  it("falls back to Sunday for an invalid tag", () => {
    expect(localeWeekStart("not a locale")).toBe(0);
    expect(localeWeekStart(undefined)).toBe(0);
  });
});

describe("weekTitle", () => {
  it("names both months when the week crosses one", () => {
    expect(weekTitle(weekDays(new Date(2026, 8, 29), 0))).toBe("Sep 27 – Oct 3, 2026");
  });

  it("names the month once inside one month", () => {
    expect(weekTitle(weekDays(new Date(2026, 9, 7), 0))).toBe("Oct 4 – 10, 2026");
  });

  it("names both years across a year end", () => {
    expect(weekTitle(weekDays(new Date(2026, 11, 30), 0))).toBe("Dec 27, 2026 – Jan 2, 2027");
  });
});

describe("gridHours", () => {
  it("runs 6 am through 9 pm with 12-hour labels", () => {
    const hours = gridHours();
    expect(hours).toHaveLength(16);
    expect(hours[0]).toEqual({ hour: 6, label: "6 AM" });
    expect(hours[6]).toEqual({ hour: 12, label: "12 PM" });
    expect(hours[15]).toEqual({ hour: 21, label: "9 PM" });
    expect(formatHour(22)).toBe("10 PM");
  });
});

describe("addDays", () => {
  it("steps across a daylight-saving change by calendar day", () => {
    const beforeChange = new Date(2026, 10, 1);
    expect(dayKey(addDays(beforeChange, 7))).toBe("2026-11-08");
    expect(dayKey(addDays(beforeChange, -7))).toBe("2026-10-25");
  });
});
