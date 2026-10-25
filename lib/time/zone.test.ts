import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dayKey,
  formatEventDate,
  formatEventRange,
  formatEventTime,
  formatInZone,
  isValidTimeZone,
  isoToLocalInput,
  localToUTCISO,
} from "./zone";

const NY = "America/New_York";
// 7:00 PM on Tuesday 29 September 2026 in New York, as the database stores it.
const SEVEN_PM_NY = "2026-09-29T23:00:00.000Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isValidTimeZone", () => {
  it("accepts IANA names Intl knows, spelled exactly", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects unknown names, abbreviations, aliases and other spellings", () => {
    expect(isValidTimeZone("Nowhere/Bogus")).toBe(false);
    expect(isValidTimeZone("EST")).toBe(false);
    expect(isValidTimeZone("US/Eastern")).toBe(false);
    expect(isValidTimeZone("america/new_york")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("localToUTCISO", () => {
  it("reads a datetime-local value as wall-clock time in the zone", () => {
    expect(localToUTCISO("2026-09-29T19:00", NY)).toBe(SEVEN_PM_NY);
    expect(localToUTCISO("2026-09-29T19:00", "America/Los_Angeles")).toBe("2026-09-30T02:00:00.000Z");
    expect(localToUTCISO("2026-09-29T19:00", "UTC")).toBe("2026-09-29T19:00:00.000Z");
  });

  it("uses the zone's offset on either side of a daylight-saving change", () => {
    // 8 March 2026: clocks go forward at 2:00 in New York.
    expect(localToUTCISO("2026-03-08T01:30", NY)).toBe("2026-03-08T06:30:00.000Z");
    expect(localToUTCISO("2026-03-08T03:30", NY)).toBe("2026-03-08T07:30:00.000Z");
    // 1 November 2026: clocks go back at 2:00.
    expect(localToUTCISO("2026-10-31T19:00", NY)).toBe("2026-10-31T23:00:00.000Z");
    expect(localToUTCISO("2026-11-01T19:00", NY)).toBe("2026-11-02T00:00:00.000Z");
  });

  it("moves a time inside the spring-forward gap to the first valid minute", () => {
    expect(localToUTCISO("2026-03-08T02:30", NY)).toBe("2026-03-08T07:30:00.000Z");
  });

  it("takes the first occurrence of a repeated autumn hour", () => {
    expect(localToUTCISO("2026-11-01T01:30", NY)).toBe("2026-11-01T05:30:00.000Z");
  });

  it("refuses a value that is not a datetime-local string", () => {
    expect(() => localToUTCISO("yesterday", NY)).toThrow(RangeError);
  });
});

describe("isoToLocalInput", () => {
  it("round-trips with localToUTCISO", () => {
    expect(isoToLocalInput(SEVEN_PM_NY, NY)).toBe("2026-09-29T19:00");
    expect(isoToLocalInput(SEVEN_PM_NY, "Asia/Tokyo")).toBe("2026-09-30T08:00");
    expect(isoToLocalInput(localToUTCISO("2026-11-01T19:00", NY), NY)).toBe("2026-11-01T19:00");
  });

  it("reads the offset form the database returns", () => {
    expect(isoToLocalInput("2026-09-29T23:00:00+00:00", NY)).toBe("2026-09-29T19:00");
  });
});

describe("formatters", () => {
  it("format in the zone, not the process zone", () => {
    expect(formatEventTime(SEVEN_PM_NY, NY)).toBe("7:00 PM");
    expect(formatEventTime(SEVEN_PM_NY, "America/Los_Angeles")).toBe("4:00 PM");
    expect(formatEventDate(SEVEN_PM_NY, NY)).toBe("Tuesday, September 29, 2026");
    expect(formatEventRange(SEVEN_PM_NY, "2026-09-30T00:30:00.000Z", NY)).toBe("7:00 PM – 8:30 PM");
    expect(formatEventRange(SEVEN_PM_NY, null, NY)).toBe("7:00 PM");
    expect(formatInZone(SEVEN_PM_NY, NY, { month: "short", day: "numeric" })).toBe("Sep 29");
    expect(dayKey(SEVEN_PM_NY, NY)).toBe("2026-09-29");
  });

  it("buckets a late evening into the zone's day, not UTC's", () => {
    expect(dayKey(SEVEN_PM_NY, "UTC")).toBe("2026-09-29");
    expect(dayKey("2026-09-30T02:30:00.000Z", NY)).toBe("2026-09-29");
    expect(dayKey("2026-09-30T02:30:00.000Z", "Asia/Tokyo")).toBe("2026-09-30");
  });
});

// The acceptance case: a 7:00 PM event entered in the org zone reads 7:00 PM
// on the same day for a viewer whose machine is in Tokyo or in UTC.
describe.each([
  { tz: "Asia/Tokyo", offsetMinutes: -540 },
  { tz: "UTC", offsetMinutes: 0 },
])("with the process in $tz", ({ tz, offsetMinutes }) => {
  it("enters and shows 7:00 PM in the org zone", () => {
    vi.stubEnv("TZ", tz);
    // The stub took effect: Date now runs in the viewer's zone.
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsetMinutes);

    expect(localToUTCISO("2026-09-29T19:00", NY)).toBe(SEVEN_PM_NY);
    expect(isoToLocalInput(SEVEN_PM_NY, NY)).toBe("2026-09-29T19:00");
    expect(formatEventTime(SEVEN_PM_NY, NY)).toBe("7:00 PM");
    expect(formatEventDate(SEVEN_PM_NY, NY)).toBe("Tuesday, September 29, 2026");
    expect(dayKey(SEVEN_PM_NY, NY)).toBe("2026-09-29");
  });
});
