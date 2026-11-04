// The hourly job's due rules, on each side of every boundary, across both
// clock changes in a US zone, and for zones that disagree about the day.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  DEFAULT_SEND_HOUR,
  FIRST_SEND_HOUR,
  LAST_SEND_HOUR,
  localClock,
  orgCanBeDue,
  RETRY_UNTIL_HOUR,
  sendHourOf,
  teamIsDue,
} from "../_shared/serving-due.ts";

const at = (iso: string) => new Date(iso);

Deno.test("localClock reads the church's date, weekday and hour", () => {
  // 02:30 UTC on Monday, Nov 2 is still Sunday evening in New York.
  const clock = localClock("America/New_York", at("2026-11-02T02:30:00Z"));
  assertEquals(clock, { date: "2026-11-01", weekday: 0, hour: 21 });
  assertEquals(localClock("UTC", at("2026-11-02T02:30:00Z")), { date: "2026-11-02", weekday: 1, hour: 2 });
});

Deno.test("localClock reports midnight as hour 0", () => {
  assertEquals(localClock("UTC", at("2026-11-02T00:10:00Z")).hour, 0);
  assertEquals(localClock("America/Chicago", at("2026-11-02T06:00:00Z")).hour, 0);
});

Deno.test("localClock throws on a zone Intl rejects", () => {
  assertThrows(() => localClock("Nowhere/Bogus", at("2026-11-02T02:30:00Z")), RangeError);
});

Deno.test("the constants agree with what the dialog offers", () => {
  assertEquals(DEFAULT_SEND_HOUR, 9);
  assertEquals(FIRST_SEND_HOUR, 6);
  assertEquals(LAST_SEND_HOUR, 21);
  assertEquals(RETRY_UNTIL_HOUR, LAST_SEND_HOUR + 1);
});

Deno.test("a church can be due from the first hour until the retry window closes", () => {
  const clockAt = (hour: number) => ({ date: "2026-11-05", weekday: 4, hour });
  assertEquals(orgCanBeDue(clockAt(FIRST_SEND_HOUR - 1)), false);
  assertEquals(orgCanBeDue(clockAt(FIRST_SEND_HOUR)), true);
  assertEquals(orgCanBeDue(clockAt(RETRY_UNTIL_HOUR - 1)), true);
  assertEquals(orgCanBeDue(clockAt(RETRY_UNTIL_HOUR)), false);
  assertEquals(orgCanBeDue(clockAt(0)), false);
});

Deno.test("a team without a chosen hour uses the default, and a chosen 9 is a choice", () => {
  assertEquals(sendHourOf({ send_hour: null }), DEFAULT_SEND_HOUR);
  assertEquals(sendHourOf({ send_hour: 9 }), 9);
  assertEquals(sendHourOf({ send_hour: 18 }), 18);
});

Deno.test("a team is due from its hour on, on its reminder days only", () => {
  const thursday = (hour: number) => ({ date: "2026-11-05", weekday: 4, hour });
  const team = { reminder_days: [4, 5], send_hour: 18 };
  assertEquals(teamIsDue(team, thursday(17)), false);
  assertEquals(teamIsDue(team, thursday(18)), true);
  assertEquals(teamIsDue(team, thursday(21)), true);
  assertEquals(teamIsDue(team, thursday(22)), false);
  assertEquals(teamIsDue(team, { date: "2026-11-04", weekday: 3, hour: 18 }), false);
});

Deno.test("a team without a chosen hour is due from the default hour", () => {
  const team = { reminder_days: [4], send_hour: null };
  assertEquals(teamIsDue(team, { date: "2026-11-05", weekday: 4, hour: 8 }), false);
  assertEquals(teamIsDue(team, { date: "2026-11-05", weekday: 4, hour: 9 }), true);
});

// Every hourly firing across a day, as pg_cron sends them.
function firings(dayUtc: string, days = 1): Date[] {
  const start = Date.parse(`${dayUtc}T00:00:00Z`);
  return Array.from({ length: 24 * days }, (_, i) => new Date(start + i * 60 * 60 * 1000));
}

/** The first firing a team becomes due on, per local date. */
function firstDueFiring(zone: string, team: { reminder_days: number[]; send_hour: number | null }, span: Date[]) {
  const first = new Map<string, string>();
  for (const now of span) {
    const clock = localClock(zone, now);
    if (teamIsDue(team, clock) && !first.has(clock.date)) first.set(clock.date, now.toISOString());
  }
  return first;
}

Deno.test("a 9 AM team is first due at 9 AM local on both sides of the spring clock change", () => {
  // New York moves from UTC-5 to UTC-4 on Sunday, March 8, 2026.
  const team = { reminder_days: [0, 6], send_hour: 9 };
  const first = firstDueFiring("America/New_York", team, firings("2026-03-07", 2));
  assertEquals(first.get("2026-03-07"), "2026-03-07T14:00:00.000Z");
  assertEquals(first.get("2026-03-08"), "2026-03-08T13:00:00.000Z");
});

Deno.test("a 9 AM team is first due at 9 AM local on both sides of the fall clock change", () => {
  // New York moves from UTC-4 to UTC-5 on Sunday, November 1, 2026.
  const team = { reminder_days: [0, 6], send_hour: 9 };
  const first = firstDueFiring("America/New_York", team, firings("2026-10-31", 2));
  assertEquals(first.get("2026-10-31"), "2026-10-31T13:00:00.000Z");
  assertEquals(first.get("2026-11-01"), "2026-11-01T14:00:00.000Z");
});

Deno.test("the hour that happens twice in the fall is outside the choosable range", () => {
  // 1 AM happens twice on November 1 in New York; neither is a send hour.
  for (const now of firings("2026-11-01")) {
    const clock = localClock("America/New_York", now);
    if (clock.hour === 1) assertEquals(orgCanBeDue(clock), false);
  }
});

Deno.test("each local date has exactly one first due firing across a whole year", () => {
  const team = { reminder_days: [0, 1, 2, 3, 4, 5, 6], send_hour: 9 };
  for (const zone of ["America/New_York", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"]) {
    const first = firstDueFiring(zone, team, firings("2026-01-01", 365));
    // The span's first and last local days are cut short; every whole day is there.
    const wholeDays = [...first.entries()].slice(1, -1);
    assertEquals(wholeDays.length >= 362, true, zone);
    for (const [date, iso] of wholeDays) {
      assertEquals(localClock(zone, new Date(iso)), { ...localClock(zone, new Date(iso)), date, hour: 9 }, `${zone} ${iso}`);
    }
  }
});

Deno.test("zones that disagree about the day are each read on their own clock", () => {
  const now = at("2026-11-05T20:00:00Z");
  const team = { reminder_days: [4], send_hour: null };
  // Thursday 10 AM in Honolulu: due. Friday 5 AM in Tokyo: a different day, and before the window.
  assertEquals(localClock("Pacific/Honolulu", now), { date: "2026-11-05", weekday: 4, hour: 10 });
  assertEquals(teamIsDue(team, localClock("Pacific/Honolulu", now)), true);
  assertEquals(localClock("Asia/Tokyo", now), { date: "2026-11-06", weekday: 5, hour: 5 });
  assertEquals(teamIsDue(team, localClock("Asia/Tokyo", now)), false);
  assertEquals(orgCanBeDue(localClock("Asia/Tokyo", now)), false);
});
