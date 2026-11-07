import { afterEach, describe, expect, it, vi } from "vitest";
import { timeAgo, toWallRow } from "./prayer";

const NY = "America/New_York";

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("shows no age for a date that won't parse", () => {
    expect(timeAgo("not a date", NY)).toBe("");
  });
});
