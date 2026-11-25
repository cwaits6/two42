// Which dinners a firing reminds: the day after the cycle's own date in the
// church's zone, at the dinner's current time.

import { assertEquals } from "jsr:@std/assert@1";
import { dinnerReadWindow, dueDinnerDate, dueDinners, type ReminderDinnerRow } from "../_shared/dinner-reminder-due.ts";

const row = (id: string, starts_at: string): ReminderDinnerRow => ({
  id,
  group_id: "g1",
  season_id: "s1",
  table_id: "t1",
  starts_at,
  host_party_id: "p1",
});

Deno.test("each firing of a cycle reminds the dinners on the church's next day", () => {
  for (const firing of ["2027-01-08T15:00:00Z", "2027-01-08T16:00:00Z", "2027-01-08T17:05:00Z"]) {
    assertEquals(dueDinnerDate(new Date(firing), "America/Chicago"), "2027-01-09");
  }
  // Before 15:00 UTC the cycle is still the day before's.
  assertEquals(dueDinnerDate(new Date("2027-01-08T14:59:00Z"), "America/Chicago"), "2027-01-08");
  assertEquals(dueDinnerDate(new Date("2027-01-08T15:00:00Z"), "Pacific/Auckland"), "2027-01-10");
});

Deno.test("only a dinner on that date is due, keyed by that date", () => {
  const now = new Date("2027-01-08T15:00:00Z");
  const due = dueDinners(
    [
      row("tomorrow", "2027-01-10T00:00:00Z"), // 6:00 PM on the 9th in Chicago
      row("late", "2027-01-10T05:30:00Z"), // 11:30 PM on the 9th
      row("today", "2027-01-08T23:00:00Z"),
      row("after", "2027-01-10T06:30:00Z"), // 12:30 AM on the 10th
    ],
    "America/Chicago",
    now,
  );
  assertEquals(due.map((d) => d.dinnerId), ["tomorrow", "late"]);
  assertEquals(due[0].dinnerDate, "2027-01-09");
  assertEquals(due[0].hostPartyId, "p1");
});

Deno.test("a moved dinner is due on its new date, not its old one", () => {
  const moved = row("moved", "2027-01-11T00:00:00Z");
  assertEquals(dueDinners([moved], "America/Chicago", new Date("2027-01-08T15:00:00Z")), []);
  assertEquals(
    dueDinners([moved], "America/Chicago", new Date("2027-01-09T15:00:00Z")).map((d) => d.dinnerDate),
    ["2027-01-10"],
  );
});

Deno.test("the read window holds the due date in any zone", () => {
  assertEquals(dinnerReadWindow(new Date("2027-01-08T16:00:00Z")), {
    from: "2027-01-08T15:00:00.000Z",
    to: "2027-01-11T15:00:00.000Z",
  });
});
