// Locks the date math the serving reminders are keyed on. Every case passes an
// explicit instant or date, so no result depends on the runtime's zone.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  formatServiceDateWithYear,
  todayIn,
  upcomingServiceDates,
  weekdayOf,
} from "../_shared/serving-dates.ts";

// Sunday evening in Los Angeles, already Monday morning in UTC.
const SUNDAY_EVENING_LA = new Date("2026-11-09T02:00:00Z");

Deno.test("todayIn reads the date in the church's zone, not UTC", () => {
  assertEquals(todayIn("America/Los_Angeles", SUNDAY_EVENING_LA), "2026-11-08");
  assertEquals(todayIn("UTC", SUNDAY_EVENING_LA), "2026-11-09");
  assertEquals(todayIn("Asia/Tokyo", SUNDAY_EVENING_LA), "2026-11-09");
});

Deno.test("todayIn throws on a zone Intl rejects", () => {
  assertThrows(() => todayIn("Nowhere/Bogus", SUNDAY_EVENING_LA), RangeError);
});

Deno.test("the church's zone decides which service date comes next", () => {
  const nextIn = (zone: string) =>
    upcomingServiceDates(1, todayIn(zone, SUNDAY_EVENING_LA))[0];
  assertEquals(nextIn("America/Los_Angeles"), "2026-11-08");
  assertEquals(nextIn("UTC"), "2026-11-15");
});

Deno.test("weekdayOf matches the 0-based reminder_days numbering", () => {
  assertEquals(weekdayOf("2026-11-08"), 0);
  assertEquals(weekdayOf("2026-11-09"), 1);
  assertEquals(weekdayOf("2026-11-14"), 6);
});

Deno.test("upcomingServiceDates starts on today when today is a service date", () => {
  assertEquals(upcomingServiceDates(1, "2026-08-09"), ["2026-08-09"]);
});

Deno.test("upcomingServiceDates moves a weekday to the next service date", () => {
  assertEquals(upcomingServiceDates(4, "2026-08-05"), [
    "2026-08-09",
    "2026-08-16",
    "2026-08-23",
    "2026-08-30",
  ]);
});

Deno.test("upcomingServiceDates crosses month and year boundaries", () => {
  assertEquals(upcomingServiceDates(1, "2026-12-30"), ["2027-01-03"]);
});

Deno.test("upcomingServiceDates with zero weeks returns an empty list", () => {
  assertEquals(upcomingServiceDates(0, "2026-08-05"), []);
});

Deno.test("formatServiceDateWithYear shows the date's own weekday", () => {
  assertEquals(formatServiceDateWithYear("2026-11-08"), "Sunday, November 8, 2026");
  assertEquals(formatServiceDateWithYear("2026-11-09"), "Monday, November 9, 2026");
});
