import { describe, expect, it } from "vitest";
import { expandVisibleEvents } from "./visibleEvents";
import type { Event } from "@/lib/types";

const NY = "America/New_York";

const event = (overrides: Partial<Event>): Event =>
  ({
    id: "e",
    group_id: "g1",
    title: "Event",
    start_time: "2026-09-29T18:00:00.000Z",
    end_time: null,
    series_id: null,
    recurrence_frequency: null,
    ...overrides,
  }) as Event;

describe("expandVisibleEvents", () => {
  it("includes a visible group's events and excludes a hidden group's", () => {
    const events = [
      event({ id: "a", group_id: "g1" }),
      event({ id: "b", group_id: "g2" }),
    ];
    expect(expandVisibleEvents(events, new Set(["g1"]), NY).map((e) => e.id)).toEqual(["a"]);
  });

  it("lets an exception row of a hidden group still suppress its series occurrence", () => {
    const series = event({
      id: "s",
      group_id: "g1",
      start_time: "2026-09-01T18:00:00.000Z",
      recurrence_frequency: "weekly",
      recurrence_end_mode: "count",
      recurrence_count: 3,
    });
    const exception = event({
      id: "x",
      group_id: "g2",
      series_id: "s",
      series_occurrence_date: "2026-09-08T18:00:00.000Z",
      start_time: "2026-09-09T18:00:00.000Z",
    });
    const visibleOnly = new Set(["g1"]);
    const withException = expandVisibleEvents([series, exception], visibleOnly, NY);
    const without = expandVisibleEvents([series], visibleOnly, NY);
    expect(without.some((e) => e.start_time.startsWith("2026-09-08"))).toBe(true);
    expect(withException.some((e) => e.start_time.startsWith("2026-09-08"))).toBe(false);
  });
});
