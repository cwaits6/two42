// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/components/events/EventListView", () => ({ EventListView: view("list") }));

const { EventsPageClient } = await import("./EventsPageClient");

let mounted: { root: Root; container: HTMLElement } | null = null;

afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () =>
    root.render(
      createElement(EventsPageClient, {
        groups: [{ id: "g1", name: "Group", color: "#b4532a", isLeader: false }],
        allEvents: [],
        userRsvps: {},
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
