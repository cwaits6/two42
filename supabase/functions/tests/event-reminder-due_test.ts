// Which event dates are due at a firing: each window on both sides of both
// of its bounds, the cycle's own boundary, both clock changes in a US zone,
// and what turns a reminder off.

import { assertEquals } from "jsr:@std/assert@1";
import {
  cycleStart,
  type DueDate,
  dueDates,
  type ReminderEventRow,
  reminderWindow,
} from "../_shared/event-reminder-due.ts";

const CHICAGO = "America/Chicago";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);
const plus = (date: Date, ms: number) => new Date(date.getTime() + ms).toISOString();

const row = (id: string, start_time: string, rest: Partial<ReminderEventRow> = {}): ReminderEventRow => ({
  id,
  group_id: "g1",
  title: `Event ${id}`,
  location: null,
  start_time,
  recurrence_frequency: null,
  recurrence_interval: 1,
  recurrence_end_mode: null,
  recurrence_count: null,
  recurrence_until: null,
  series_id: null,
  series_occurrence_date: null,
  is_cancelled: false,
  reminder_days_before: 1,
  ...rest,
});

const weekly = (id: string, start_time: string, rest: Partial<ReminderEventRow> = {}) =>
  row(id, start_time, { recurrence_frequency: "weekly", recurrence_end_mode: "never", ...rest });

function due(rows: ReminderEventRow[], now: Date, groupsOff: string[] = []): DueDate[] {
  return dueDates({ rows, groupsOff: new Set(groupsOff), zone: CHICAGO, now });
}

// The 15:00 UTC firing on Thursday, Nov 5.
const FIRING = at("2026-11-05T15:00:00.000Z");

Deno.test("a cycle starts at 15:00 UTC and lasts until the next one", () => {
  assertEquals(cycleStart(at("2026-11-05T14:59:59.999Z")).toISOString(), "2026-11-04T15:00:00.000Z");
  assertEquals(cycleStart(at("2026-11-05T15:00:00.000Z")).toISOString(), "2026-11-05T15:00:00.000Z");
  assertEquals(cycleStart(at("2026-11-05T16:59:00.000Z")).toISOString(), "2026-11-05T15:00:00.000Z");
  assertEquals(cycleStart(at("2026-11-06T00:30:00.000Z")).toISOString(), "2026-11-05T15:00:00.000Z");
});

Deno.test("no reminder, and a value the form never offers, have no window", () => {
  assertEquals(reminderWindow(0, FIRING), null);
  assertEquals(reminderWindow(3, FIRING), null);
});

for (const days of [1, 2, 7]) {
  Deno.test(`${days} day(s) before is due inside that 24 hours of the cycle and on neither side`, () => {
    const lower = FIRING.getTime() + (days - 1) * DAY;
    const upper = FIRING.getTime() + days * DAY;
    const dueAt = (ts: number) =>
      due([row("e", new Date(ts).toISOString(), { reminder_days_before: days })], FIRING).length;
    assertEquals(dueAt(lower), 0, "exactly on the lower bound");
    assertEquals(dueAt(lower + 1), 1, "just after the lower bound");
    assertEquals(dueAt(upper), 1, "exactly on the upper bound");
    assertEquals(dueAt(upper + 1), 0, "just after the upper bound");
  });

  Deno.test(`${days} day(s) before is due in one cycle only`, () => {
    const start = plus(FIRING, days * DAY - 6 * HOUR);
    const event = row("e", start, { reminder_days_before: days });
    const cycles = [];
    for (let back = -2; back <= 9; back++) {
      const firing = new Date(FIRING.getTime() - back * DAY);
      if (due([event], firing).length > 0) cycles.push(firing.toISOString());
    }
    assertEquals(cycles, [FIRING.toISOString()]);
  });
}

Deno.test("every firing of a cycle sees the same dates", () => {
  const events = [
    row("a", plus(FIRING, 3 * HOUR)),
    row("b", plus(FIRING, DAY)),
    row("c", plus(FIRING, DAY + 1)),
  ];
  const ids = (now: Date) => due(events, now).map((d) => d.recordEventId);
  assertEquals(ids(FIRING), ["a", "b"]);
  assertEquals(ids(at("2026-11-05T16:00:00Z")), ["a", "b"]);
  assertEquals(ids(at("2026-11-05T17:00:00Z")), ["a", "b"]);
});

Deno.test("a start that is not after the firing's clock is not due", () => {
  const event = row("e", "2026-11-05T15:30:00.000Z");
  assertEquals(due([event], at("2026-11-05T15:29:59.999Z")).length, 1);
  assertEquals(due([event], at("2026-11-05T15:30:00.000Z")).length, 0);
  assertEquals(due([event], at("2026-11-05T16:00:00.000Z")).length, 0);
});

Deno.test("the job as it ran before never reached a later date of a series, and this one does", () => {
  // Wednesdays at 7:00 PM in Chicago, first on Oct 28: the row's own start
  // is the only instant the earlier query compared with the next 24 hours.
  const series = weekly("s", "2026-10-29T00:00:00.000Z");
  const firing = at("2026-11-04T15:00:00.000Z");
  const rowStart = new Date(series.start_time).getTime();
  assertEquals(rowStart >= firing.getTime() && rowStart <= firing.getTime() + DAY, false);

  assertEquals(due([series], firing), [{
    groupId: "g1",
    recordEventId: "s",
    occurrenceDate: "2026-11-04",
    replyEventId: null,
    linkPath: "/calendar/s?occurrence=2026-11-05T01%3A00%3A00.000Z",
    startIso: "2026-11-05T01:00:00.000Z",
    title: "Event s",
    location: null,
  }]);
});

for (
  const [name, first, from, to] of [
    ["clocks go back", "2026-10-22T00:00:00.000Z", "2026-10-20", "2026-11-20"],
    ["clocks go forward", "2027-02-25T01:00:00.000Z", "2027-02-24", "2027-03-27"],
  ]
) {
  Deno.test(`a weekly event is due once before each date, at 7:00 PM local, when ${name}`, () => {
    const series = weekly("s", first);
    const seen: string[] = [];
    for (let day = at(`${from}T15:00:00Z`); day < at(`${to}T15:00:00Z`); day = new Date(day.getTime() + DAY)) {
      for (const date of due([series], day)) {
        seen.push(new Date(date.startIso).toLocaleString("en-US", {
          timeZone: CHICAGO,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }));
      }
    }
    assertEquals(seen.length, 5);
    assertEquals(seen.every((label) => label.endsWith("7:00 PM")), true, seen.join(" | "));
    assertEquals(new Set(seen).size, 5);
  });
}

Deno.test("a group that is off sends nothing, whatever each event chose", () => {
  const events = [1, 2, 7].map((days) =>
    row(`e${days}`, plus(FIRING, days * DAY - HOUR), { reminder_days_before: days })
  );
  assertEquals(due(events, FIRING).length, 3);
  assertEquals(due(events, FIRING, ["g1"]), []);
  assertEquals(due(events, FIRING, ["another-group"]).length, 3);
});

Deno.test("a choice changed before the firing takes effect on it", () => {
  const start = plus(FIRING, 5 * HOUR);
  assertEquals(due([row("e", start, { reminder_days_before: 1 })], FIRING).length, 1);
  assertEquals(due([row("e", start, { reminder_days_before: 0 })], FIRING), []);
  assertEquals(due([row("e", start, { reminder_days_before: 2 })], FIRING), []);
});

Deno.test("a date deleted from a series sends none, and the next week still comes", () => {
  const series = weekly("s", "2026-10-29T00:00:00.000Z");
  // Nov 4 at 7:00 PM in Chicago, deleted on its own.
  const deleted = row("x", "2026-11-05T01:00:00.000Z", {
    series_id: "s",
    series_occurrence_date: "2026-11-05T01:00:00.000Z",
    is_cancelled: true,
  });
  const firing = at("2026-11-04T15:00:00Z");
  assertEquals(due([series], firing).length, 1);
  assertEquals(due([series, deleted], firing), []);
  const next = due([series, deleted], at("2026-11-11T15:00:00Z"));
  assertEquals(next.map((d) => d.occurrenceDate), ["2026-11-11"]);
});

Deno.test("a date edited on its own uses its own time and title and its series' choice", () => {
  const series = weekly("s", "2026-10-29T00:00:00.000Z", { reminder_days_before: 2, title: "Group night" });
  // The Nov 4 date moved to Friday evening, at a new place.
  const moved = row("m", "2026-11-07T00:30:00.000Z", {
    series_id: "s",
    series_occurrence_date: "2026-11-05T01:00:00.000Z",
    title: "Group night at the park",
    location: "Riverside Park",
    reminder_days_before: 0,
  });
  // Two days ahead of the day it stood on, the series' own date would be due.
  const before = at("2026-11-03T15:00:00Z");
  assertEquals(due([series], before).length, 1);
  assertEquals(due([series, moved], before), []);
  assertEquals(due([series, moved], FIRING), [{
    groupId: "g1",
    recordEventId: "s",
    occurrenceDate: "2026-11-04",
    replyEventId: "m",
    linkPath: "/calendar/m",
    startIso: "2026-11-07T00:30:00.000Z",
    title: "Group night at the park",
    location: "Riverside Park",
  }]);
});

Deno.test("a date edited on its own whose series is not read is not due", () => {
  const moved = row("m", plus(FIRING, HOUR), { series_id: "s", series_occurrence_date: plus(FIRING, HOUR) });
  assertEquals(due([moved], FIRING), []);
});

Deno.test("a single event is recorded under its own id and local day", () => {
  // 9:30 PM on Nov 5 in Chicago is already Nov 6 in UTC.
  assertEquals(due([row("e", "2026-11-06T03:30:00.000Z", { location: "Room 4" })], FIRING), [{
    groupId: "g1",
    recordEventId: "e",
    occurrenceDate: "2026-11-05",
    replyEventId: null,
    linkPath: "/calendar/e",
    startIso: "2026-11-06T03:30:00.000Z",
    title: "Event e",
    location: "Room 4",
  }]);
});
