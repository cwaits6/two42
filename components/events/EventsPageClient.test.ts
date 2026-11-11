// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/components/events/useIsPhone", () => ({ useIsPhone: () => false }));
// Each view renders the switch inside its own subtree, as the real ones do.
function view(name: string) {
  return function View({ viewSwitch }: { viewSwitch: ReactNode }) {
    return createElement("section", { "data-view": name }, viewSwitch);
  };
}
vi.mock("@/components/events/EventCalendarView", () => ({ EventCalendarView: view("month") }));
vi.mock("@/components/events/EventWeekView", () => ({ EventWeekView: view("week") }));
// Like the real list, only an empty list renders the Add event link, so a
// count of links proves the page offers it exactly once.
vi.mock("@/components/events/EventListView", () => ({
  EventListView: ({
    viewSwitch,
    events,
    createHref,
  }: {
    viewSwitch: ReactNode;
    events: unknown[];
    createHref: string | null;
  }) =>
    createElement(
      "section",
      { "data-view": "list" },
      viewSwitch,
      events.length === 0 && createHref && createElement("a", { href: createHref }, "Add event")
    ),
}));

const { EventsPageClient } = await import("./EventsPageClient");

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

const NEXT_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const UPCOMING = {
  id: "e1",
  group_id: "g1",
  title: "Group night",
  description: null,
  location: null,
  start_time: NEXT_WEEK,
  end_time: null,
  calendar_id: null,
  is_rsvp_enabled: false,
  created_by: null,
  created_at: NEXT_WEEK,
  recurrence_frequency: null,
  recurrence_interval: 1,
  recurrence_end_mode: null,
  recurrence_count: null,
  recurrence_until: null,
  series_id: null,
  series_occurrence_date: null,
  is_cancelled: false,
} as Event;

async function mount({ isLeader = false, allEvents = [] as Event[] } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(EventsPageClient, {
        groups: [{ id: "g1", name: "Group", color: "#b4532a", isLeader }],
        allEvents,
        replies: [],
        userId: "u1",
        timeZone: "America/Chicago",
      })
    )
  );
  const radio = (label: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find((r) => r.textContent === label)!;
  return { container, radio };
}

describe("EventsPageClient view switch", () => {
  it("keeps focus on the checked view when an arrow key changes the view", async () => {
    const { container, radio } = await mount();
    radio("Month").focus();
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(container.querySelector("[data-view]")?.getAttribute("data-view")).toBe("week");
    expect(document.activeElement).toBe(radio("Week"));
    expect(radio("Week").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps focus on the clicked view", async () => {
    const { radio } = await mount();
    await act(async () => radio("List").click());
    expect(document.activeElement).toBe(radio("List"));
  });

  it("leaves focus alone on first render", async () => {
    await mount();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("EventsPageClient Add event", () => {
  const addEvents = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("a")).filter((a) => a.textContent === "Add event");

  it("offers Add event once in an empty list view, from the empty state and not the header", async () => {
    const { container, radio } = await mount({ isLeader: true });
    expect(addEvents(container)).toHaveLength(1);
    await act(async () => radio("List").click());
    const links = addEvents(container);
    expect(links).toHaveLength(1);
    expect(links[0].closest('[data-view="list"]')).not.toBeNull();
  });

  it("keeps Add event in the header when the list has upcoming events", async () => {
    const { container, radio } = await mount({ isLeader: true, allEvents: [UPCOMING] });
    await act(async () => radio("List").click());
    const links = addEvents(container);
    expect(links).toHaveLength(1);
    expect(links[0].closest('[data-view="list"]')).toBeNull();
  });
});
