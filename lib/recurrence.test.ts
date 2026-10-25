import { afterEach, describe, expect, it, vi } from "vitest";
import { addRecurrenceInterval, expandOccurrences, expandUpcomingEvents } from "./recurrence";
import { formatEventTime } from "@/lib/time/zone";
import type { Event } from "@/lib/types";

const NY = "America/New_York";
// 7:00 PM on Tuesday 27 October 2026 in New York (EDT); clocks go back on 1 November.
const SEVEN_PM_BEFORE_CHANGE = "2026-10-27T23:00:00.000Z";

const series = (overrides: Partial<Event> = {}): Event =>
  ({
    id: "s",
    group_id: "g1",
    title: "Weekly",
    start_time: SEVEN_PM_BEFORE_CHANGE,
    end_time: "2026-10-28T00:30:00.000Z",
    series_id: null,
    recurrence_frequency: "weekly",
    recurrence_interval: 1,
    recurrence_end_mode: "count",
    recurrence_count: 3,
    recurrence_until: null,
    ...overrides,
  }) as Event;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("addRecurrenceInterval", () => {
  it("steps by the calendar in the zone, keeping the wall-clock time", () => {
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "daily", 1, NY)).toBe("2026-10-28T23:00:00.000Z");
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "weekly", 1, NY)).toBe("2026-11-04T00:00:00.000Z");
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "monthly", 1, NY)).toBe("2026-11-28T00:00:00.000Z");
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "yearly", 1, NY)).toBe("2027-10-27T23:00:00.000Z");
  });

  it("keeps the wall-clock time in the zone it is given, not the process zone", () => {
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "weekly", 1, "UTC")).toBe("2026-11-03T23:00:00.000Z");
    expect(addRecurrenceInterval(SEVEN_PM_BEFORE_CHANGE, "weekly", 1, "Asia/Tokyo")).toBe("2026-11-03T23:00:00.000Z");
  });

  it("returns an unparseable value unchanged", () => {
    expect(addRecurrenceInterval("yesterday", "weekly", 1, NY)).toBe("yesterday");
  });
});

// The acceptance case for a series: a weekly 7:00 PM meeting entered in the
// org zone stays at 7:00 PM across the daylight-saving change for a viewer
// whose browser, or whose server, runs in Tokyo or UTC.
describe.each([
  { tz: "Asia/Tokyo", offsetMinutes: -540 },
  { tz: "UTC", offsetMinutes: 0 },
  { tz: NY, offsetMinutes: 240 },
])("with the process in $tz", ({ tz, offsetMinutes }) => {
  it("expands a weekly series at 7:00 PM in the org zone on either side of the change", () => {
    vi.stubEnv("TZ", tz);
    expect(new Date(2026, 9, 15).getTimezoneOffset()).toBe(offsetMinutes);

    const occurrences = expandOccurrences(series(), NY);
    expect(occurrences.map((o) => o.start_time)).toEqual([
      SEVEN_PM_BEFORE_CHANGE,
      "2026-11-04T00:00:00.000Z",
      "2026-11-11T00:00:00.000Z",
    ]);
    expect(occurrences.map((o) => o.end_time)).toEqual([
      "2026-10-28T00:30:00.000Z",
      "2026-11-04T01:30:00.000Z",
      "2026-11-11T01:30:00.000Z",
    ]);
    for (const o of occurrences) expect(formatEventTime(o.start_time, NY)).toBe("7:00 PM");
  });

  it("lists upcoming occurrences at the org's hour", () => {
    vi.stubEnv("TZ", tz);
    const now = new Date("2026-10-30T12:00:00.000Z");
    const upcoming = expandUpcomingEvents([series()], NY, now);
    expect(upcoming.map((o) => o.start_time)).toEqual([
      "2026-11-04T00:00:00.000Z",
      "2026-11-11T00:00:00.000Z",
    ]);
  });
});

describe("expandOccurrences", () => {
  it("skips an occurrence covered by an exception row", () => {
    const excluded = new Set([Date.parse("2026-11-04T00:00:00.000Z")]);
    expect(expandOccurrences(series(), NY, excluded).map((o) => o.start_time)).toEqual([
      SEVEN_PM_BEFORE_CHANGE,
      "2026-11-11T00:00:00.000Z",
    ]);
  });

  it("stops at the series' until date", () => {
    const untilSeries = series({
      recurrence_end_mode: "until",
      recurrence_count: null,
      recurrence_until: "2026-11-05T00:00:00.000Z",
    });
    expect(expandOccurrences(untilSeries, NY).map((o) => o.start_time)).toEqual([
      SEVEN_PM_BEFORE_CHANGE,
      "2026-11-04T00:00:00.000Z",
    ]);
  });
});
