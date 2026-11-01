import { afterEach, describe, expect, it, vi } from "vitest";
import { nextOccurrence, sessionEnd, sessionLabel, timeAgo, toCallSession, toWallRow } from "./prayer";

const NY = "America/New_York";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("nextOccurrence", () => {
  // Monday 2 November 2026, 10:00 AM in New York.
  const MONDAY_10AM_NY = new Date("2026-11-02T15:00:00.000Z");

  it("reads the session time in the church's zone with the browser in Tokyo", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-540);
    // Tuesdays at 9:00 AM in New York is 14:00 UTC in November.
    expect(nextOccurrence(2, "09:00", NY, MONDAY_10AM_NY).toISOString()).toBe(
      "2026-11-03T14:00:00.000Z"
    );
  });

  it("counts today while the start is still ahead, and next week once it has passed", () => {
    expect(nextOccurrence(1, "12:00", NY, MONDAY_10AM_NY).toISOString()).toBe(
      "2026-11-02T17:00:00.000Z"
    );
    expect(nextOccurrence(1, "08:00", NY, MONDAY_10AM_NY).toISOString()).toBe(
      "2026-11-09T13:00:00.000Z"
    );
  });

  it("ends on the next day when the end is not after the start", () => {
    const start = new Date("2026-11-03T04:00:00.000Z"); // 11:00 PM Monday in New York
    expect(sessionEnd(start, "00:30", NY).toISOString()).toBe("2026-11-03T05:30:00.000Z");
    expect(sessionEnd(start, "23:30", NY).toISOString()).toBe("2026-11-03T04:30:00.000Z");
  });
});

describe("timeAgo", () => {
  it("dates an older request by the church's calendar, not the browser's", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const now = new Date("2026-10-31T12:00:00.000Z");
    // 10:30 PM on 8 July in New York is already 9 July in Tokyo.
    expect(timeAgo("2026-07-09T02:30:00.000Z", NY, now)).toBe("Jul 8");
    expect(timeAgo("2025-07-09T02:30:00.000Z", NY, now)).toBe("Jul 8, 2025");
  });
});

describe("rows with unexpected values", () => {
  it("turns a malformed wall row into one the card can show", () => {
    const row = toWallRow({
      id: "r1",
      body: null,
      is_anonymous: "yes",
      created_at: 17,
      mine: null,
      first_name: 5,
      praying_count: null,
      i_am_praying: null,
      category: "Health",
    });
    expect(row).toMatchObject({
      id: "r1",
      body: "",
      is_anonymous: false,
      created_at: "",
      mine: false,
      first_name: null,
      praying_count: 0,
      i_am_praying: false,
    });
    expect(row).not.toHaveProperty("category");
  });

  it("keeps only https join links on a call session", () => {
    expect(toCallSession({ join_url: "https://meet.example/x" }).join_url).toBe("https://meet.example/x");
    expect(toCallSession({ join_url: "javascript:alert(1)" }).join_url).toBeNull();
    expect(toCallSession({ join_url: "data:text/html,hi" }).join_url).toBeNull();
    expect(toCallSession({ join_url: "http://meet.example/x" }).join_url).toBeNull();
  });

  it("labels a session whose day or time is out of range without throwing", () => {
    expect(sessionLabel(toCallSession({ weekday: 9, start_time: "soon", end_time: null }))).toBe("soon");
    expect(sessionLabel(toCallSession({ weekday: "2", start_time: null }))).toBe("");
    expect(sessionLabel({ weekday: 3, start_time: "20:00:00", end_time: "20:30:00" })).toBe(
      "Wednesdays · 8:00 – 8:30 PM"
    );
    expect(sessionLabel({ weekday: 3, start_time: "11:30:00", end_time: "12:30:00" })).toBe(
      "Wednesdays · 11:30 AM – 12:30 PM"
    );
  });

  it("shows no age for a date that won't parse", () => {
    expect(timeAgo("not a date", NY)).toBe("");
  });
});
