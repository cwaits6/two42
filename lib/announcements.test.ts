import { afterEach, describe, expect, it, vi } from "vitest";
import { announcementStatus, publishChoiceOf, publishFields } from "./announcements";

const NY = "America/New_York";
const NOW = new Date("2026-11-02T12:00:00.000Z");
// 9:00 AM on Tuesday 3 November 2026 in New York (EST, UTC-5).
const NINE_AM_NY = "2026-11-03T14:00:00.000Z";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  { tz: "Asia/Tokyo", offsetMinutes: -540 },
  { tz: "America/Los_Angeles", offsetMinutes: 480 },
])("scheduling with the browser in $tz", ({ tz, offsetMinutes }) => {
  it("stores 9:00 in the church's zone, not the browser's", () => {
    vi.stubEnv("TZ", tz);
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(offsetMinutes);

    expect(publishFields("schedule", "2026-11-03T09:00", NY, NOW)).toEqual({
      ok: true,
      is_published: true,
      published_at: NINE_AM_NY,
    });
  });
});

describe("publishFields", () => {
  it("saves a draft with no publish date", () => {
    expect(publishFields("draft", "2026-11-03T09:00", NY, NOW)).toEqual({
      ok: true,
      is_published: false,
      published_at: null,
    });
  });

  it("publishes now", () => {
    expect(publishFields("now", "", NY, NOW)).toEqual({
      ok: true,
      is_published: true,
      published_at: NOW.toISOString(),
    });
  });

  it("keeps the original date when an already published announcement is saved", () => {
    const previous = { is_published: true, published_at: "2026-10-01T12:00:00.000Z" };
    expect(publishFields("now", "", NY, NOW, previous)).toMatchObject({
      published_at: "2026-10-01T12:00:00.000Z",
    });
  });

  it("publishes a scheduled or draft announcement as of now", () => {
    const scheduled = { is_published: true, published_at: NINE_AM_NY };
    const draft = { is_published: false, published_at: null };
    expect(publishFields("now", "", NY, NOW, scheduled)).toMatchObject({ published_at: NOW.toISOString() });
    expect(publishFields("now", "", NY, NOW, draft)).toMatchObject({ published_at: NOW.toISOString() });
  });

  it("asks for a date when scheduling without one", () => {
    expect(publishFields("schedule", "", NY, NOW)).toEqual({
      ok: false,
      error: "Enter a date and time to publish.",
    });
    expect(publishFields("schedule", "not a date", NY, NOW)).toMatchObject({ ok: false });
  });

  it("refuses a time that has already passed in the church's zone", () => {
    expect(publishFields("schedule", "2026-11-02T06:59", NY, NOW)).toEqual({
      ok: false,
      error: "Enter a time that hasn't passed yet.",
    });
  });
});

describe("announcementStatus and publishChoiceOf", () => {
  it("reads draft, scheduled and published", () => {
    const draft = { is_published: false, published_at: NINE_AM_NY };
    const scheduled = { is_published: true, published_at: NINE_AM_NY };
    const published = { is_published: true, published_at: "2026-10-01T12:00:00.000Z" };
    expect(announcementStatus(draft, NOW)).toBe("Draft");
    expect(announcementStatus(scheduled, NOW)).toBe("Scheduled");
    expect(announcementStatus(published, NOW)).toBe("Published");
    expect(publishChoiceOf(draft, NOW)).toBe("draft");
    expect(publishChoiceOf(scheduled, NOW)).toBe("schedule");
    expect(publishChoiceOf(published, NOW)).toBe("now");
  });
});
