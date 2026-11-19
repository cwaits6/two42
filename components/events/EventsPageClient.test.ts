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

type TestGroup = { id: string; name: string; color: string; isLeader: boolean };

async function mount({
  isLeader = false,
  allEvents = [] as Event[],
  groups = undefined as TestGroup[] | undefined,
} = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(EventsPageClient, {
        groups: groups ?? [{ id: "g1", name: "Group", color: "#b4532a", isLeader }],
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

describe("EventsPageClient Subscribe", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function choose(container: HTMLElement, name: string) {
    const trigger = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Subscribe")!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      trigger.click();
    });
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent === name
    )!;
    await act(async () => item.click());
  }

  it("opens the dialog with the group's feed links after a group is chosen", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "tok123" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mount();
    await choose(container, "Group");
    const apple = Array.from(document.querySelectorAll("a")).find((a) => a.textContent === "Open in Apple Calendar");
    expect(apple?.getAttribute("href")).toBe(
      `webcal://${window.location.host}/api/calendar/feed.ics?token=tok123&group=g1`
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open and says so when the link could not be made", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { container } = await mount();
    await choose(container, "Group");
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(document.body.textContent).toContain("Subscribe to Group");
  });

  const appleHref = () =>
    Array.from(document.querySelectorAll("a"))
      .find((a) => a.textContent === "Open in Apple Calendar")
      ?.getAttribute("href");

  async function close() {
    const button = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Close")!;
    await act(async () => button.click());
  }

  // A second mint replaces the person's token, so it would break the link
  // the first choice already handed out.
  it("asks for one link per page view however many choices are made", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "tok123" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mount();
    await choose(container, "Group");
    const first = appleHref();
    await close();
    await choose(container, "Group");
    expect(appleHref()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed link when the person tries again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, json: async () => ({ token: "tok456" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mount();
    await choose(container, "Group");
    const retry = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    expect(appleHref()).toContain("token=tok456");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks again after a failed link when the person chooses again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true, json: async () => ({ token: "tok789" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mount();
    await choose(container, "Group");
    await close();
    await choose(container, "Group");
    expect(appleHref()).toContain("token=tok789");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares the pending link request and shows the latest choice's links", async () => {
    let resolve!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = await mount({
      groups: [
        { id: "g1", name: "Group", color: "#b4532a", isLeader: false },
        { id: "g2", name: "Other group", color: "#c99a2e", isLeader: false },
      ],
    });
    await choose(container, "Group");
    await close();
    await choose(container, "Other group");
    await act(async () => resolve({ ok: true, json: async () => ({ token: "tokP" }) }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(appleHref()).toBe(`webcal://${window.location.host}/api/calendar/feed.ics?token=tokP&group=g2`);
  });
});
