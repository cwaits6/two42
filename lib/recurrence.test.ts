import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addRecurrenceInterval,
  countUpcomingOccurrences,
  expandOccurrences,
  expandUpcomingEvents,
  occurrenceEndTime,
} from "./recurrence";
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
    const excluded = new Set(["2026-11-03"]);
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

describe("monthly stepping on the 29th to 31st", () => {
  const JAN_31_7PM = "2027-02-01T00:00:00.000Z";

  it("clamps to the last day of a short month instead of overflowing into the next", () => {
    const monthly = series({
      start_time: JAN_31_7PM,
      end_time: null,
      recurrence_frequency: "monthly",
      recurrence_count: 4,
    });
    expect(expandOccurrences(monthly, NY).map((o) => o.start_time)).toEqual([
      JAN_31_7PM,
      "2027-03-01T00:00:00.000Z",
      "2027-03-31T23:00:00.000Z",
      "2027-04-30T23:00:00.000Z",
    ]);
  });
});

describe("weekly stepping across the spring-forward change", () => {
  it("keeps 7:00 PM when clocks go forward on 14 March 2027", () => {
    const weekly = series({ start_time: "2027-03-10T00:00:00.000Z", end_time: null });
    const occurrences = expandOccurrences(weekly, NY);
    expect(occurrences.map((o) => o.start_time)).toEqual([
      "2027-03-10T00:00:00.000Z",
      "2027-03-16T23:00:00.000Z",
      "2027-03-23T23:00:00.000Z",
    ]);
    for (const o of occurrences) expect(formatEventTime(o.start_time, NY)).toBe("7:00 PM");
  });
});

describe("exception rows are matched by calendar day", () => {
  const exception = (occurrenceDate: string): Event =>
    series({
      id: "x",
      series_id: "s",
      series_occurrence_date: occurrenceDate,
      recurrence_frequency: null,
      recurrence_end_mode: null,
      recurrence_count: null,
      start_time: occurrenceDate,
    });
  const starts = (events: Event[], now: Date) =>
    expandUpcomingEvents(events, NY, now, new Date("2027-12-31T00:00:00.000Z"))
      .filter((o) => !o.series_id)
      .map((o) => o.start_time);

  it("suppresses an occurrence whose exception row was stepped in a zone without the change", () => {
    // Stepped by 7 x 24 h across the autumn change, the row sits an hour off
    // the 7:00 PM occurrence on the same New York day.
    const anchor = series({ recurrence_count: 3 });
    const now = new Date("2026-10-01T00:00:00.000Z");
    const rows = [anchor, exception("2026-11-03T23:00:00.000Z")];
    expect(starts(rows, now)).toEqual([SEVEN_PM_BEFORE_CHANGE, "2026-11-11T00:00:00.000Z"]);
  });

  it("suppresses an occurrence whose row was written for the same day in an earlier month step", () => {
    const anchor = series({
      start_time: "2027-02-01T00:00:00.000Z",
      end_time: null,
      recurrence_frequency: "monthly",
      recurrence_count: 3,
    });
    const now = new Date("2027-01-01T00:00:00.000Z");
    // 31 March at 6:00 PM local on the day of the 7:00 PM occurrence.
    const rows = [anchor, exception("2027-03-31T22:00:00.000Z")];
    expect(starts(rows, now)).toEqual(["2027-02-01T00:00:00.000Z", "2027-03-01T00:00:00.000Z"]);
  });

  it("still keeps an occurrence on a different day", () => {
    const anchor = series({ recurrence_count: 3 });
    const now = new Date("2026-10-01T00:00:00.000Z");
    const rows = [anchor, exception("2026-11-05T00:00:00.000Z")];
    expect(starts(rows, now)).toHaveLength(3);
  });

  it("drops a cancelled date without showing the cancelled row itself", () => {
    const anchor = series({ recurrence_count: 3 });
    const now = new Date("2026-10-01T00:00:00.000Z");
    const cancelled = { ...exception("2026-11-04T00:00:00.000Z"), is_cancelled: true };
    const upcoming = expandUpcomingEvents([anchor, cancelled], NY, now);
    expect(upcoming.map((o) => o.start_time)).toEqual([
      SEVEN_PM_BEFORE_CHANGE,
      "2026-11-11T00:00:00.000Z",
    ]);
    expect(upcoming.some((o) => o.id === "x")).toBe(false);
  });
});

describe("occurrenceEndTime", () => {
  it("keeps the series' duration from the occurrence start", () => {
    expect(occurrenceEndTime(series(), "2026-11-04T00:00:00.000Z")).toBe("2026-11-04T01:30:00.000Z");
  });

  it("is null for a series with no end time", () => {
    expect(occurrenceEndTime(series({ end_time: null }), "2026-11-04T00:00:00.000Z")).toBeNull();
  });
});

describe("countUpcomingOccurrences", () => {
  const now = new Date("2026-10-30T12:00:00.000Z");

  it("counts the dates still to come of a series that ends after a count", () => {
    expect(countUpcomingOccurrences(series(), NY, now)).toBe(2);
    expect(countUpcomingOccurrences(series({ recurrence_count: 1 }), NY, now)).toBe(0);
  });

  it("counts the dates still to come of a series that ends on a date", () => {
    const untilSeries = series({
      recurrence_end_mode: "until",
      recurrence_count: null,
      recurrence_until: "2026-11-20T00:00:00.000Z",
    });
    expect(countUpcomingOccurrences(untilSeries, NY, now)).toBe(3);
  });

  it("counts every remaining date of a long series, past the expansion budget", () => {
    // Daily for three years from 27 October 2026: 1,097 dates, three of them before `now`.
    const daily = series({
      recurrence_frequency: "daily",
      recurrence_end_mode: "until",
      recurrence_count: null,
      recurrence_until: "2029-10-28T12:00:00.000Z",
    });
    expect(countUpcomingOccurrences(daily, NY, now)).toBe(1094);
  });

  it("is null for a series with no end, a one-off, and an exception row", () => {
    expect(countUpcomingOccurrences(series({ recurrence_end_mode: "never", recurrence_count: null }), NY, now)).toBeNull();
    expect(countUpcomingOccurrences(series({ recurrence_frequency: null }), NY, now)).toBeNull();
    expect(countUpcomingOccurrences(series({ series_id: "other" }), NY, now)).toBeNull();
  });
});

