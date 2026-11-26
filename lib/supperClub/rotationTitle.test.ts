import { describe, expect, it } from "vitest";
import { rotationTitle } from "./rotationTitle";

describe("rotationTitle", () => {
  it.each([
    ["2027-03-06", "2027-05-29", "Spring 2027"],
    ["2027-06-05", "2027-08-28", "Summer 2027"],
    ["2026-09-07", "2026-11-23", "Fall 2026"],
    ["2026-12-05", "2027-02-27", "Winter 2026"],
  ])("names dates inside one part of the year: %s to %s is %s", (start, end, title) => {
    expect(rotationTitle(start, end, [])).toBe(title);
  });

  it("names January and February for the winter that began the December before", () => {
    expect(rotationTitle("2027-01-09", "2027-02-27", [])).toBe("Winter 2026");
  });

  it("gives a month range when the dates span parts of one year", () => {
    expect(rotationTitle("2026-09-07", "2026-12-14", [])).toBe("Sep – Dec 2026");
  });

  it("gives a month range with both years when the dates cross a year outside winter", () => {
    expect(rotationTitle("2026-11-07", "2027-01-30", [])).toBe("Nov 2026 – Jan 2027");
  });

  it("falls back to the one month when the dates sit in a single month", () => {
    expect(rotationTitle("2026-09-05", "2026-09-26", [])).toBe("Fall 2026");
    expect(rotationTitle("2026-09-05", "2026-09-26", ["Fall 2026"])).toBe("Sep 2026");
  });

  it("names both years for a range a year long", () => {
    expect(rotationTitle("2026-09-05", "2027-09-04", [])).toBe("Sep 2026 – Sep 2027");
  });

  it("falls back to the month range when another rotation has the title", () => {
    expect(rotationTitle("2026-09-07", "2026-11-23", ["Fall 2026"])).toBe("Sep – Nov 2026");
  });

  it("compares titles without case or surrounding spaces", () => {
    expect(rotationTitle("2026-09-07", "2026-11-23", ["  fall 2026 "])).toBe("Sep – Nov 2026");
  });

  it("numbers the month range when that is taken too", () => {
    const taken = ["Fall 2026", "Sep – Nov 2026"];
    expect(rotationTitle("2026-09-07", "2026-11-23", taken)).toBe("Sep – Nov 2026 (2)");
    expect(rotationTitle("2026-09-07", "2026-11-23", [...taken, "Sep – Nov 2026 (2)"])).toBe("Sep – Nov 2026 (3)");
  });

  it("numbers a month range that is taken", () => {
    expect(rotationTitle("2026-09-07", "2026-12-14", ["Sep – Dec 2026"])).toBe("Sep – Dec 2026 (2)");
  });

  it("gives nothing for missing, impossible or reversed dates", () => {
    expect(rotationTitle("", "2026-11-23", [])).toBe("");
    expect(rotationTitle("2026-09-07", "", [])).toBe("");
    expect(rotationTitle("2026-02-30", "2026-03-30", [])).toBe("");
    expect(rotationTitle("2026-11-23", "2026-09-07", [])).toBe("");
  });
});
