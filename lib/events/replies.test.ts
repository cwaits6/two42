import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_DURATION_MS } from "@/lib/meetings";
import { expandOccurrences } from "@/lib/recurrence";
import type { Event } from "@/lib/types";
import { replyDateFilter, replyFor, replyKey, replyOpen, repliesForDate, type ReplyRow } from "./replies";

const ZONE = "America/Chicago";

function event(over: Partial<Event> & { id: string; start_time: string }): Event {
  return {
    title: "Event",
    description: null,
    location: null,
    end_time: null,
    created_by: null,
    created_at: "2031-01-01T00:00:00Z",
    calendar_id: null,
    group_id: "g1",
    is_rsvp_enabled: true,
    recurrence_frequency: null,
    recurrence_interval: 1,
    recurrence_end_mode: null,
    recurrence_count: null,
    recurrence_until: null,
    series_id: null,
    series_occurrence_date: null,
    is_cancelled: false,
    ...over,
  } as Event;
}

// The same series and days are pinned in event_reply_dates_suite.sql.
// 23:30 on Sunday Nov 2, 2031 in Chicago is 05:30 Monday in UTC.
const LATE_SUNDAYS = event({
  id: "late",
  start_time: "2031-11-03T05:30:00Z",
  recurrence_frequency: "weekly",
  recurrence_end_mode: "never",
});
// 19:00 on Sunday Oct 26, 2031 in Chicago, across both clock changes.
const EVENING_SUNDAYS = event({
  id: "evening",
  start_time: "2031-10-27T00:00:00Z",
  recurrence_frequency: "weekly",
  recurrence_end_mode: "count",
  recurrence_count: 22,
});

const row = (over: Partial<ReplyRow> & { event_id: string }): ReplyRow => ({
  user_id: "me",
  status: "yes",
  occurrence_date: null,
  ...over,
});

describe("replyKey", () => {
  it("keys a late-evening date by its day in the church's zone, not in UTC", () => {
    const dates = expandOccurrences(LATE_SUNDAYS, ZONE, undefined, new Date("2031-11-20T00:00:00Z"));
    expect(dates.map((d) => replyKey(d, ZONE))).toEqual([
      { eventId: "late", date: "2031-11-02", editedId: null },
      { eventId: "late", date: "2031-11-09", editedId: null },
      { eventId: "late", date: "2031-11-16", editedId: null },
    ]);
  });

  it("keeps a weekly series' days a week apart across both clock changes", () => {
    const dates = expandOccurrences(EVENING_SUNDAYS, ZONE, undefined, new Date("2033-01-01T00:00:00Z")).map((d) => replyKey(d, ZONE).date);
    expect(dates).toContain("2031-11-02");
    expect(dates).toContain("2032-03-14");
    for (let i = 1; i < dates.length; i++) {
      expect(Date.parse(dates[i]) - Date.parse(dates[i - 1])).toBe(7 * 86_400_000);
    }
  });

  it("keys a date edited on its own to its series and the day it stood on", () => {
    const moved = event({
      id: "moved",
      start_time: "2031-11-11T01:00:00Z",
      series_id: "evening",
      series_occurrence_date: "2031-11-10T01:00:00Z",
    });
    expect(replyKey(moved, ZONE)).toEqual({ eventId: "evening", date: "2031-11-09", editedId: "moved" });
  });

  it("keys a one-time event by its own day", () => {
    expect(replyKey(event({ id: "picnic", start_time: "2031-07-05T04:00:00Z" }), ZONE)).toEqual({
      eventId: "picnic",
      date: "2031-07-04",
      editedId: null,
    });
  });
});

describe("repliesForDate", () => {
  const key = { eventId: "evening", date: "2031-11-09", editedId: "moved" };

  it("prefers the edited date's own row, then the dated row, then a row with no date", () => {
    const own = row({ event_id: "moved", status: "no" });
    const dated = row({ event_id: "evening", occurrence_date: "2031-11-09", status: "maybe" });
    const undated = row({ event_id: "evening", user_id: "me-too" });
    expect(replyFor([undated, dated, own], key, "me")).toBe(own);
    expect(replyFor([undated, dated], key, "me")).toBe(dated);
    expect(replyFor([row({ event_id: "evening" })], key, "me")?.status).toBe("yes");
  });

  it("leaves a date unanswered when the only reply is for another date", () => {
    const other = row({ event_id: "evening", occurrence_date: "2031-11-16" });
    expect(replyFor([other], key, "me")).toBeNull();
    expect(replyFor([other], { ...key, date: "2031-11-16" }, "me")).toBe(other);
  });

  it("holds one reply per person, and only for this event", () => {
    const rows = [
      row({ event_id: "evening", user_id: "ana", occurrence_date: "2031-11-09" }),
      row({ event_id: "evening", user_id: "ana" }),
      row({ event_id: "evening", user_id: "ben", occurrence_date: "2031-11-16" }),
      row({ event_id: "elsewhere", user_id: "cy", occurrence_date: "2031-11-09" }),
    ];
    const forDate = repliesForDate(rows, key);
    expect([...forDate.keys()]).toEqual(["ana"]);
    expect(forDate.get("ana")?.occurrence_date).toBe("2031-11-09");
  });
});

describe("replyDateFilter", () => {
  it("names the series' dated and undated rows", () => {
    expect(replyDateFilter({ eventId: "e1", date: "2031-11-09", editedId: null })).toBe(
      "and(event_id.eq.e1,or(occurrence_date.eq.2031-11-09,occurrence_date.is.null))",
    );
  });

  it("adds the edited date's own row", () => {
    expect(replyDateFilter({ eventId: "e1", date: "2031-11-09", editedId: "x1" })).toBe(
      "and(event_id.eq.e1,or(occurrence_date.eq.2031-11-09,occurrence_date.is.null)),event_id.eq.x1",
    );
  });
});

describe("replyOpen", () => {
  const start = "2031-11-09T15:00:00Z";
  const end = "2031-11-09T16:00:00Z";

  it("takes replies before the date and while it runs, and not once it has ended", () => {
    expect(replyOpen(new Date("2031-11-08T00:00:00Z"), start, end)).toBe(true);
    expect(replyOpen(new Date("2031-11-09T15:30:00Z"), start, end)).toBe(true);
    expect(replyOpen(new Date(end), start, end)).toBe(false);
    expect(replyOpen(new Date("2031-11-10T00:00:00Z"), start, end)).toBe(false);
  });

  it("ends a date with no end time after the default length", () => {
    expect(replyOpen(new Date("2031-11-09T16:59:00Z"), start, null)).toBe(true);
    expect(replyOpen(new Date("2031-11-09T17:00:00Z"), start, null)).toBe(false);
  });
});

describe("event_reply_day()", () => {
  it("ends a date with no end time where the app does", () => {
    const migration = readFileSync("supabase/migrations/20261120000000_event_reply_dates.sql", "utf8");
    const hours = [...migration.matchAll(/interval '(\d+) hours'/g)].map(([, n]) => Number(n));
    expect(hours).toHaveLength(2);
    expect(hours.map((n) => n * 3600000)).toEqual([DEFAULT_EVENT_DURATION_MS, DEFAULT_EVENT_DURATION_MS]);
  });
});
