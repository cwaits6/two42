// Locks the date math the serving reminders are keyed on. Every case passes an
// explicit instant or date, so no result depends on the runtime's zone.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  formatServiceDateWithYear,
  reminderRun,
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

const churchIn = (timezone: string) => ({ timezone });
const dailyRun = (date: string) => new Date(`${date}T08:00:00Z`);

Deno.test("a reminder run reads the org's own time zone", () => {
  const sundayEveningUtc = new Date("2026-11-08T20:00:00Z");
  assertEquals(reminderRun(churchIn("UTC"), sundayEveningUtc), {
    today: "2026-11-08",
    weekday: 0,
    serviceDate: "2026-11-08",
  });
  assertEquals(reminderRun(churchIn("Asia/Tokyo"), sundayEveningUtc), {
    today: "2026-11-09",
    weekday: 1,
    serviceDate: "2026-11-15",
  });
  assertThrows(() => reminderRun(churchIn("Nowhere/Bogus")), RangeError);
});

Deno.test("a reminder run landing on the church's previous evening acts on the coming date", () => {
  // 10 PM Saturday in Honolulu: Sunday's reminder, before that Sunday's service.
  assertEquals(reminderRun(churchIn("Pacific/Honolulu"), dailyRun("2026-11-08")), {
    today: "2026-11-08",
    weekday: 0,
    serviceDate: "2026-11-08",
  });
  // 11 PM Sunday in Anchorage, after the service: the next reminder names next Sunday.
  assertEquals(reminderRun(churchIn("America/Anchorage"), dailyRun("2026-11-02")), {
    today: "2026-11-02",
    weekday: 1,
    serviceDate: "2026-11-08",
  });
});

Deno.test("every daily run acts on the next date across daylight saving", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const first = dailyRun("2026-01-01").getTime();
  // The zones that reach midnight at this hour, plus their neighbours either side.
  const zones = [
    "America/Anchorage", "America/Juneau", "America/Metlakatla", "America/Nome",
    "America/Sitka", "America/Yakutat", "America/Adak", "Pacific/Honolulu",
    "Pacific/Pago_Pago", "America/Los_Angeles", "America/New_York", "Europe/London",
    "Asia/Tokyo", "Pacific/Norfolk", "Pacific/Auckland", "Pacific/Chatham",
    "Pacific/Kiritimati",
  ];
  for (const zone of zones) {
    for (let day = 0; day < 365; day++) {
      const now = new Date(first + day * DAY_MS);
      const { today, serviceDate } = reminderRun(churchIn(zone), now);
      assertEquals(today, now.toISOString().slice(0, 10), zone);
      // A service date already behind the church's own date would be a past turn.
      assertEquals(serviceDate >= todayIn(zone, now), true, zone);
    }
  }
});
