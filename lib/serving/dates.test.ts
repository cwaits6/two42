import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatServingDate,
  isUpcomingServiceDate,
  pastServiceDates,
  statsRange,
  todayIn,
  upcomingServiceDates,
  windowWeeksError,
} from "./dates";

describe("todayIn", () => {
  // 2026-11-02 02:30 UTC is still the evening of Sun, Nov 1 in New York.
  const lateSundayEvening = new Date("2026-11-02T02:30:00Z");

  it("reads the date in the church's zone, not UTC", () => {
    expect(todayIn("America/New_York", lateSundayEvening)).toBe("2026-11-01");
    expect(todayIn("UTC", lateSundayEvening)).toBe("2026-11-02");
    expect(todayIn("Australia/Sydney", new Date("2026-10-31T14:00:00Z"))).toBe("2026-11-01");
  });
});

describe("upcomingServiceDates", () => {
  it("starts with today when today is a schedule date", () => {
    expect(upcomingServiceDates(3, "2026-11-01")).toEqual(["2026-11-01", "2026-11-08", "2026-11-15"]);
  });

  it("starts at the next schedule date otherwise, across a month and year end", () => {
    expect(upcomingServiceDates(2, "2026-10-31")).toEqual(["2026-11-01", "2026-11-08"]);
    expect(upcomingServiceDates(2, "2026-12-29")).toEqual(["2027-01-03", "2027-01-10"]);
  });

  it("returns nothing for zero weeks", () => {
    expect(upcomingServiceDates(0, "2026-11-01")).toEqual([]);
  });
});

describe("pastServiceDates", () => {
  it("lists dates before today, newest first, back to the first one", () => {
    expect(pastServiceDates("2026-10-18", "2026-11-04")).toEqual(["2026-11-01", "2026-10-25", "2026-10-18"]);
  });

  it("leaves today out when today is a schedule date", () => {
    expect(pastServiceDates("2026-10-25", "2026-11-01")).toEqual(["2026-10-25"]);
  });

  it("is empty when nothing has passed yet", () => {
    expect(pastServiceDates("2026-11-08", "2026-11-04")).toEqual([]);
  });
});

describe("isUpcomingServiceDate", () => {
  it("accepts today and later schedule dates", () => {
    expect(isUpcomingServiceDate("2026-11-01", "2026-11-01")).toBe(true);
    expect(isUpcomingServiceDate("2026-11-08", "2026-11-01")).toBe(true);
  });

  it("refuses a past date, another weekday and malformed input", () => {
    expect(isUpcomingServiceDate("2026-10-25", "2026-11-01")).toBe(false);
    expect(isUpcomingServiceDate("2026-11-04", "2026-11-01")).toBe(false);
    expect(isUpcomingServiceDate("2026-02-31", "2026-01-01")).toBe(false);
    expect(isUpcomingServiceDate("Nov 8", "2026-11-01")).toBe(false);
  });
});

describe("daysUntil", () => {
  it("counts calendar days, through a clock change", () => {
    expect(daysUntil("2026-11-01", "2026-11-01")).toBe(0);
    expect(daysUntil("2026-11-08", "2026-10-31")).toBe(8);
  });
});

describe("formatServingDate", () => {
  it("writes the date with the weekday it falls on", () => {
    expect(formatServingDate("2026-11-08")).toBe("Sun, Nov 8");
  });

  it("adds the year only when it is not this year", () => {
    expect(formatServingDate("2026-11-08", "2026-10-31")).toBe("Sun, Nov 8");
    expect(formatServingDate("2025-12-28", "2026-10-31")).toBe("Sun, Dec 28, 2025");
  });
});

describe("windowWeeksError", () => {
  it("accepts a whole number from 1 to 26", () => {
    expect(windowWeeksError("1")).toBeUndefined();
    expect(windowWeeksError("26")).toBeUndefined();
  });

  it("asks for a whole number in range otherwise", () => {
    for (const value of ["", " ", "0", "27", "2.5", "eight"]) {
      expect(windowWeeksError(value)).toBe("Enter a whole number from 1 to 26.");
    }
  });
});

describe("statsRange", () => {
  it("bounds a calendar year in the church's year", () => {
    expect(statsRange("thisYear", "2026-01-01")).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(statsRange("lastYear", "2026-01-01")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });

  it("goes back six months to today, clamping a day the earlier month lacks", () => {
    expect(statsRange("6mo", "2026-08-31")).toEqual({ start: "2026-02-28", end: "2026-08-31" });
  });

  it("leaves all time unbounded", () => {
    expect(statsRange("all", "2026-10-31")).toEqual({ start: null, end: null });
  });
});
