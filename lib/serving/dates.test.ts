import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEAM_DATES,
  blockError,
  daysUntil,
  formatMonthDay,
  formatServingDate,
  isUpcomingServiceDate,
  listDates,
  openDatesAfter,
  openDatesLine,
  pastServiceDates,
  serviceDatesBetween,
  statsRange,
  sundaysLabel,
  teamServiceDates,
  todayIn,
  upcomingServiceDates,
  windowWeeksError,
  type TeamDatesSettings,
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

describe("serviceDatesBetween", () => {
  it("lists the Sundays from the first on or after From to To", () => {
    expect(serviceDatesBetween("2026-11-02", "2026-11-22")).toEqual(["2026-11-08", "2026-11-15", "2026-11-22"]);
    expect(serviceDatesBetween("2026-11-08", "2026-11-08")).toEqual(["2026-11-08"]);
    expect(serviceDatesBetween("2026-11-09", "2026-11-14")).toEqual([]);
  });
});

describe("teamServiceDates", () => {
  const block: TeamDatesSettings = { schedule: "set", window_weeks: 8, date_from: "2026-10-11", date_to: "2027-05-02" };

  it("covers 30 Sundays from October 11, 2026 to May 2, 2027", () => {
    const dates = teamServiceDates(block, "2026-10-01");
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe("2026-10-11");
    expect(dates.at(-1)).toBe("2027-05-02");
    expect(sundaysLabel("2026-10-11", "2027-05-02")).toBe("30 Sundays");
  });

  it("drops the block's past dates and is empty once it has ended", () => {
    expect(teamServiceDates(block, "2027-04-26")).toEqual(["2027-05-02"]);
    expect(teamServiceDates(block, "2027-05-03")).toEqual([]);
  });

  it("is the rolling window with the defaults", () => {
    expect(teamServiceDates(DEFAULT_TEAM_DATES, "2026-11-04")).toEqual(upcomingServiceDates(8, "2026-11-04"));
  });
});

describe("blockError", () => {
  it("needs both dates, To after From, within a year", () => {
    expect(blockError("", "2027-05-02")).toBeDefined();
    expect(blockError("2026-10-11", "2026-10-11")).toBe("Choose a To date after the From date.");
    expect(blockError("2026-10-11", "2027-10-11")).toBeUndefined();
    expect(blockError("2026-10-11", "2027-10-12")).toBe("Set dates can cover up to a year.");
    expect(blockError("2026-10-11", "2027-05-02")).toBeUndefined();
  });
});

describe("openDatesAfter", () => {
  const dates = ["2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06"];
  const openUnless = (taken: string[]) => (d: string) => !taken.includes(d);

  it("offers the open dates in a row after the chosen one, up to the count", () => {
    expect(openDatesAfter("2026-11-15", dates, openUnless([]), 1)).toEqual(["2026-11-22"]);
    expect(openDatesAfter("2026-11-15", dates, openUnless([]), 3)).toEqual(["2026-11-22", "2026-11-29", "2026-12-06"]);
  });

  it("stops at the first taken date and at the end of the team's dates", () => {
    expect(openDatesAfter("2026-11-15", dates, openUnless(["2026-11-22"]), 2)).toEqual([]);
    expect(openDatesAfter("2026-11-15", dates, openUnless(["2026-11-29"]), 3)).toEqual(["2026-11-22"]);
    expect(openDatesAfter("2026-12-06", dates, openUnless([]), 2)).toEqual([]);
    expect(openDatesAfter("2026-11-01", dates, openUnless([]), 2)).toEqual([]);
  });
});

describe("openDatesLine", () => {
  const dates = ["2026-11-08", "2026-11-15", "2027-05-02"];

  it("counts the open dates through the last one", () => {
    expect(openDatesLine(dates, (d) => d !== "2026-11-08", "2026-11-04")).toBe("2 open dates through May 2, 2027");
    expect(openDatesLine(dates, (d) => d === "2027-05-02", "2027-01-04")).toBe("1 open date through May 2");
    expect(openDatesLine(dates, () => false, "2027-01-04")).toBe("Every date through May 2 is taken");
    expect(openDatesLine([], () => true, "2027-01-04")).toBe("No dates to sign up for");
  });
});

describe("listDates", () => {
  it("joins with commas and a final and", () => {
    const short = (d: string) => formatMonthDay(d);
    expect(listDates(["2026-11-22"], short)).toBe("Nov 22");
    expect(listDates(["2026-11-22", "2026-11-29"], short)).toBe("Nov 22 and Nov 29");
    expect(listDates(["2026-11-22", "2026-11-29", "2026-12-06"], short)).toBe("Nov 22, Nov 29 and Dec 6");
  });
});
