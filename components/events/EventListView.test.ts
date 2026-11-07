// @vitest-environment jsdom
import { act, createElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expandOccurrences } from "@/lib/recurrence";
import type { ReplyRow } from "@/lib/events/replies";
import type { Event } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) =>
    createElement("a", { href, ref, ...rest }, children),
}));
vi.mock("@/components/events/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
vi.mock("@/components/events/CalendarToolbar", () => ({ CalendarToolbar: () => null }));
vi.mock("@/components/events/RsvpControl", () => ({
  RsvpControl: ({ occurrenceDate, currentStatus }: { occurrenceDate: string; currentStatus: string | null }) =>
    createElement("output", { "data-date": occurrenceDate }, currentStatus ?? "none"),
}));

const { EventListView, LIST_PAGE } = await import("./EventListView");

const ZONE = "America/New_York";
const SUNDAYS = {
  id: "sunday-class",
  title: "Sunday Class",
  description: null,
  location: "Room 242",
  start_time: "2031-11-02T14:30:00Z",
  end_time: "2031-11-02T15:30:00Z",
  created_by: null,
  created_at: "2031-01-01T00:00:00Z",
  calendar_id: null,
  group_id: "b",
  is_rsvp_enabled: true,
  recurrence_frequency: "weekly",
  recurrence_interval: 1,
  recurrence_end_mode: "count",
  recurrence_count: 25,
  recurrence_until: null,
  series_id: null,
  series_occurrence_date: null,
  is_cancelled: false,
} as Event;
const dates = expandOccurrences(SUNDAYS, ZONE, undefined, new Date("2033-01-01T00:00:00Z"));
const groups = [{ id: "b", name: "Group B", color: "#B5532E", isLeader: false }];

let mounted: { root: Root; container: HTMLElement } | null = null;

async function mount(replies: ReplyRow[] = [], events: Event[] = dates) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(EventListView, {
        groups,
        events,
        replies,
        userId: "me",
        createHref: null,
        timeZone: ZONE,
        viewSwitch: null,
      }),
    );
  });
  const cards = () => Array.from(container.querySelectorAll("[data-date]"));
  const more = () =>
    Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Show more dates");
  return {
    container,
    cards,
    replies: () => cards().map((c) => [c.getAttribute("data-date"), c.textContent]),
    more,
    async showMore() {
      await act(async () => {
        more()?.click();
      });
    },
  };
}

afterEach(async () => {
  if (!mounted) return;
  const { root, container } = mounted;
  await act(async () => root.unmount());
  container.remove();
  mounted = null;
});

describe("EventListView", () => {
  it("shows a page of dates and adds a page each time Show more dates is pressed", async () => {
    const view = await mount();
    expect(view.cards()).toHaveLength(LIST_PAGE);
    await view.showMore();
    expect(view.cards()).toHaveLength(2 * LIST_PAGE);
    await view.showMore();
    expect(view.cards()).toHaveLength(dates.length);
    expect(view.more()).toBeUndefined();
  });

  it("reaches a date in a later month and moves focus to the first date added", async () => {
    const view = await mount();
    expect(view.container.textContent).not.toContain("Sunday, January 11, 2032");
    await view.showMore();
    expect(view.container.textContent).toContain("Sunday, January 11, 2032");
    expect(document.activeElement?.textContent).toBe("Sunday Class");
    const titles = Array.from(view.container.querySelectorAll("a")).filter((a) => a.textContent === "Sunday Class");
    expect(document.activeElement).toBe(titles[LIST_PAGE]);
  });

  it("gives each date the reply for that date only", async () => {
    const view = await mount([
      { event_id: "sunday-class", user_id: "me", status: "no", occurrence_date: "2031-11-02" },
      { event_id: "sunday-class", user_id: "me", status: "yes", occurrence_date: "2031-11-16" },
      { event_id: "sunday-class", user_id: "someone-else", status: "maybe", occurrence_date: "2031-11-09" },
    ]);
    expect(view.replies().slice(0, 4)).toEqual([
      ["2031-11-02", "no"],
      ["2031-11-09", "none"],
      ["2031-11-16", "yes"],
      ["2031-11-23", "none"],
    ]);
  });

  it("keeps each shown date's date, time and place", async () => {
    const view = await mount([], dates.slice(0, 2));
    const text = view.container.textContent ?? "";
    expect(text).toContain("Sunday, November 2, 2031");
    expect(text).toContain("Sunday, November 9, 2031");
    expect(text).toContain("9:30 AM");
    expect(text).toContain("Room 242");
    expect(view.more()).toBeUndefined();
  });
});
