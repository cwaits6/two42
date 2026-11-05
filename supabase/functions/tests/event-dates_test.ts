// The dates of a repeating event as the reminder job works them out, across
// both clock changes in a US zone. lib/recurrence.test.ts holds the
// comparison with the calendar's own rules.

import { assertEquals } from "jsr:@std/assert@1";
import { localDay, seriesDatesBetween, type SeriesRule, stepOccurrence } from "../_shared/event-dates.ts";

const CHICAGO = "America/Chicago";
const at = (iso: string) => new Date(iso);

const weekly = (start_time: string, rest: Partial<SeriesRule> = {}): SeriesRule => ({
  start_time,
  recurrence_frequency: "weekly",
  recurrence_interval: 1,
  recurrence_end_mode: "never",
  recurrence_count: null,
  recurrence_until: null,
  ...rest,
});

Deno.test("localDay reads the day in the church's zone", () => {
  assertEquals(localDay("2026-11-06T04:30:00Z", CHICAGO), "2026-11-05");
  assertEquals(localDay("2026-11-06T04:30:00Z", "UTC"), "2026-11-06");
});

Deno.test("a weekly 7:00 PM stays 7:00 PM when clocks go back", () => {
  // Wednesday, Oct 28 at 7:00 PM CDT; clocks go back on Nov 1.
  const start = "2026-10-29T00:00:00.000Z";
  assertEquals(stepOccurrence(start, "weekly", 1, CHICAGO), "2026-11-05T01:00:00.000Z");
  assertEquals(stepOccurrence(start, "weekly", 2, CHICAGO), "2026-11-12T01:00:00.000Z");
});

Deno.test("a weekly 7:00 PM stays 7:00 PM when clocks go forward", () => {
  // Wednesday, Mar 10 at 7:00 PM CST; clocks go forward on Mar 14.
  const start = "2027-03-11T01:00:00.000Z";
  assertEquals(stepOccurrence(start, "weekly", 1, CHICAGO), "2027-03-18T00:00:00.000Z");
});

Deno.test("a time the clocks skip lands after the gap", () => {
  // 2:30 AM does not exist in Chicago on Mar 14, 2027.
  assertEquals(stepOccurrence("2027-03-07T08:30:00.000Z", "weekly", 1, CHICAGO), "2027-03-14T08:30:00.000Z");
});

Deno.test("a monthly series from the 31st takes the last day of a shorter month", () => {
  const start = "2027-01-31T18:00:00.000Z";
  assertEquals(stepOccurrence(start, "monthly", 1, "UTC"), "2027-02-28T18:00:00.000Z");
  assertEquals(stepOccurrence(start, "monthly", 2, "UTC"), "2027-03-31T18:00:00.000Z");
});

Deno.test("the window leaves out its start and holds its end", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z");
  const second = at("2026-11-05T01:00:00.000Z");
  const third = at("2026-11-12T01:00:00.000Z");
  assertEquals(seriesDatesBetween(rule, CHICAGO, second, third), ["2026-11-12T01:00:00.000Z"]);
  assertEquals(
    seriesDatesBetween(rule, CHICAGO, new Date(second.getTime() - 1), new Date(third.getTime() - 1)),
    ["2026-11-05T01:00:00.000Z"],
  );
});

Deno.test("the first date counts when the window holds it", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z");
  assertEquals(
    seriesDatesBetween(rule, CHICAGO, at("2026-10-28T00:00:00Z"), at("2026-10-30T00:00:00Z")),
    ["2026-10-29T00:00:00.000Z"],
  );
});

Deno.test("an excluded day is skipped and the next date still comes", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z");
  assertEquals(
    seriesDatesBetween(rule, CHICAGO, at("2026-11-01T00:00:00Z"), at("2026-11-13T00:00:00Z"), new Set(["2026-11-04"])),
    ["2026-11-12T01:00:00.000Z"],
  );
});

Deno.test("a series ends after its count", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z", { recurrence_end_mode: "count", recurrence_count: 2 });
  assertEquals(
    seriesDatesBetween(rule, CHICAGO, at("2026-10-01T00:00:00Z"), at("2026-12-31T00:00:00Z")),
    ["2026-10-29T00:00:00.000Z", "2026-11-05T01:00:00.000Z"],
  );
});

Deno.test("a series ends at its until, which still counts", () => {
  const all = (recurrence_until: string) =>
    seriesDatesBetween(
      weekly("2026-10-29T00:00:00.000Z", { recurrence_end_mode: "until", recurrence_until }),
      CHICAGO,
      at("2026-11-01T00:00:00Z"),
      at("2026-12-31T00:00:00Z"),
    );
  assertEquals(all("2026-11-05T01:00:00.000Z"), ["2026-11-05T01:00:00.000Z"]);
  assertEquals(all("2026-11-05T00:59:59.999Z"), []);
});

Deno.test("every other week skips the week between", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z", { recurrence_interval: 2 });
  assertEquals(
    seriesDatesBetween(rule, CHICAGO, at("2026-10-30T00:00:00Z"), at("2026-11-13T00:00:00Z")),
    ["2026-11-12T01:00:00.000Z"],
  );
});

Deno.test("a step of zero or less has no series dates", () => {
  const after = at("2026-11-01T00:00:00Z");
  const upTo = at("2026-12-01T00:00:00Z");
  for (const recurrence_interval of [0, -1, 1.5]) {
    const rule = weekly("2026-10-29T00:00:00.000Z", { recurrence_interval });
    assertEquals(seriesDatesBetween(rule, CHICAGO, after, upTo), []);
  }
});

Deno.test("a row that does not repeat has no series dates", () => {
  const rule = weekly("2026-10-29T00:00:00.000Z", { recurrence_frequency: null });
  assertEquals(seriesDatesBetween(rule, CHICAGO, at("2026-10-01T00:00:00Z"), at("2026-12-31T00:00:00Z")), []);
});
