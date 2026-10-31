import { describe, expect, it } from "vitest";
import { nextWholeHour, zoneName } from "./eventTimes";

describe("zoneName", () => {
  it("names a zone the way people say it", () => {
    expect(zoneName("America/Chicago")).toBe("Central Time");
    expect(zoneName("America/New_York")).toBe("Eastern Time");
  });

  it("falls back to the zone's own name when there is no common one", () => {
    expect(zoneName("Etc/GMT+5")).toBe("Etc/GMT+5");
  });
});

describe("nextWholeHour", () => {
  const now = new Date("2026-10-31T14:20:00Z");

  it("rounds up to the next hour on the org's clock, not the browser's", () => {
    expect(nextWholeHour("America/Chicago", now)).toBe("2026-10-31T10:00");
    expect(nextWholeHour("Asia/Tokyo", now)).toBe("2026-11-01T00:00");
  });

  it("moves a time already on the hour forward a full hour", () => {
    expect(nextWholeHour("UTC", new Date("2026-10-31T14:00:00Z"))).toBe("2026-10-31T15:00");
  });
});
