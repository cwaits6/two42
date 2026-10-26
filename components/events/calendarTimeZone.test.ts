import { afterEach, describe, expect, it, vi } from "vitest";
import luxonPlugin from "@fullcalendar/luxon3";

// The Month view hands FullCalendar the stored UTC instants and the org zone;
// this is the conversion the plugin performs to place them. Without a
// named-zone plugin FullCalendar silently falls back to UTC.
const NamedZone = luxonPlugin.namedTimeZonedImpl!;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  { tz: "Asia/Tokyo", offsetMinutes: -540 },
  { tz: "UTC", offsetMinutes: 0 },
])("with the browser in $tz", ({ tz, offsetMinutes }) => {
  it("gives the Month view the org's 7:00 PM on the org's day", () => {
    vi.stubEnv("TZ", tz);
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsetMinutes);

    const zone = new NamedZone("America/New_York");
    // [year, month (0-based), day, hour, minute, second, millisecond]
    expect(zone.timestampToArray(Date.parse("2026-09-29T23:00:00.000Z"))).toEqual([2026, 8, 29, 19, 0, 0, 0]);
    expect(zone.offsetForArray([2026, 8, 29, 19, 0, 0, 0])).toBe(-240);
  });
});
