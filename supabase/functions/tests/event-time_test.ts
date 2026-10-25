// The reminder's event time must read in the org's zone, not the runtime's
// (UTC), and a zone the runtime cannot format in must fall back rather than
// stop the send.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  formatReminderDate,
  intlKnowsTimeZone,
  reminderTimeZone,
} from "../_shared/event-time.ts";

// 7:00 PM on Tuesday 29 September 2026 in New York, as the database stores it.
const SEVEN_PM_NY = "2026-09-29T23:00:00.000Z";

Deno.test("formatReminderDate shows the org's wall clock", () => {
  const ny = formatReminderDate(SEVEN_PM_NY, "America/New_York");
  assertStringIncludes(ny, "Tuesday, September 29");
  assertStringIncludes(ny, "7:00 PM");

  const la = formatReminderDate(SEVEN_PM_NY, "America/Los_Angeles");
  assertStringIncludes(la, "Tuesday, September 29");
  assertStringIncludes(la, "4:00 PM");

  // Late evening in New York is already the next morning in Tokyo.
  const tokyo = formatReminderDate(SEVEN_PM_NY, "Asia/Tokyo");
  assertStringIncludes(tokyo, "Wednesday, September 30");
  assertStringIncludes(tokyo, "8:00 AM");
});

Deno.test("formatReminderDate in UTC is the stored instant", () => {
  const utc = formatReminderDate(SEVEN_PM_NY, "UTC");
  assertStringIncludes(utc, "September 29");
  assertStringIncludes(utc, "11:00 PM");
});

Deno.test("intlKnowsTimeZone accepts IANA names and refuses what Intl cannot format", () => {
  assert(intlKnowsTimeZone("America/New_York"));
  assert(intlKnowsTimeZone("Asia/Kolkata"));
  assert(intlKnowsTimeZone("UTC"));
  assertEquals(intlKnowsTimeZone("Nowhere/Bogus"), false);
  assertEquals(intlKnowsTimeZone("posix/America/New_York"), false);
  assertEquals(intlKnowsTimeZone(""), false);
});

Deno.test("reminderTimeZone keeps a known zone and falls back to UTC otherwise", () => {
  assertEquals(reminderTimeZone("America/Chicago"), "America/Chicago");
  assertEquals(reminderTimeZone("Nowhere/Bogus"), "UTC");
});
