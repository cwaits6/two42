// Pure units for the cleanup's date rules.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  expiredCutoff,
  feedbackCutoff,
  isLiveSignupToken,
  monthsBefore,
  prayerCutoff,
  reminderCutoff,
} from "../_shared/retention.ts";

const NOW = new Date("2026-11-03T09:00:00.000Z");

Deno.test("the expired cutoff is exactly 90 days back, across a DST change", () => {
  assertEquals(expiredCutoff(NOW), "2026-08-05T09:00:00.000Z");
});

Deno.test("the reminder cutoff is the send date 35 days back", () => {
  assertEquals(reminderCutoff(new Date("2026-11-03T09:00:00Z")), "2026-09-29");
});

Deno.test("the feedback cutoff is 12 calendar months back", () => {
  assertEquals(feedbackCutoff(NOW), "2025-11-03T09:00:00.000Z");
});

Deno.test("monthsBefore clamps to the end of a shorter month", () => {
  assertEquals(
    monthsBefore(new Date("2026-08-31T09:00:00.000Z"), 6).toISOString(),
    "2026-02-28T09:00:00.000Z",
  );
  assertEquals(
    monthsBefore(new Date("2028-02-29T09:00:00.000Z"), 12).toISOString(),
    "2027-02-28T09:00:00.000Z",
  );
});

Deno.test("monthsBefore crosses a year and keeps the day and time", () => {
  assertEquals(
    monthsBefore(new Date("2026-03-15T01:02:03.004Z"), 6).toISOString(),
    "2025-09-15T01:02:03.004Z",
  );
});

Deno.test("prayerCutoff is null while the setting is off", () => {
  assertEquals(prayerCutoff(null, NOW), null);
});

Deno.test("prayerCutoff measures each offered period", () => {
  assertEquals(prayerCutoff(6, NOW), "2026-05-03T09:00:00.000Z");
  assertEquals(prayerCutoff(12, NOW), "2025-11-03T09:00:00.000Z");
  assertEquals(prayerCutoff(24, NOW), "2024-11-03T09:00:00.000Z");
});

Deno.test("prayerCutoff refuses anything not offered rather than deleting on it", () => {
  for (const value of [0, 1, 7, "6", undefined]) {
    assertThrows(() => prayerCutoff(value, NOW), Error, "unknown prayer request period");
  }
});

Deno.test("a setup link is live until its expiry and with no expiry at all", () => {
  assertEquals(isLiveSignupToken("2026-11-03T09:00:00.001Z", NOW), true);
  assertEquals(isLiveSignupToken("2026-11-03T09:00:00.000Z", NOW), true);
  assertEquals(isLiveSignupToken("2026-11-03T08:59:59.999Z", NOW), false);
  assertEquals(isLiveSignupToken(null, NOW), true);
});
