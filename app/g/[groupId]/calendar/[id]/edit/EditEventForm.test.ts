// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const update = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/GoogleMapsScript", () => ({ GoogleMapsScript: () => null }));
vi.mock("@/components/events/LocationInput", () => ({
  LocationInput: ({ id, name }: { id: string; name: string }) => createElement("input", { id, name }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (row: unknown) => {
        update(row);
        const chain = { eq: () => chain, select: async () => ({ data: [{ id: "e1" }], error: null }) };
        return chain;
      },
    }),
  }),
}));

const { EditEventForm } = await import("./EditEventForm");

// A one-off event that kept only its location out, leaving the rest to the group.
const event = {
  id: "e1",
  group_id: "g1",
  title: "Supper",
  description: null,
  location: null,
  start_time: "2026-11-05T18:00:00.000Z",
  end_time: null,
  is_rsvp_enabled: false,
  series_id: null,
  recurrence_frequency: null,
  meeting_url: null,
  meeting_id: null,
  meeting_passcode: null,
  meeting_show_on_dashboard: true,
  meeting_lead_minutes: 15,
  calendar_meeting_details: null,
  calendar_event_notes: null,
  calendar_event_location: false,
} as unknown as Event;

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => update.mockReset());

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
      createElement(EditEventForm, {
        groupId: "g1",
        event,
        timeZone: "America/Chicago",
        groupSharing: { joinDetails: false, notes: true, location: true },
      })
    )
  );
  const submit = () =>
    act(async () =>
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
  return { container, submit };
}

describe("EditEventForm calendar subscriptions", () => {
  it("leaves an event's choices alone when the section is not changed", async () => {
    const { submit } = await mount();
    await submit();
    expect(update).toHaveBeenCalledOnce();
    const row = update.mock.calls[0][0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("calendar_meeting_details");
    expect(row).not.toHaveProperty("calendar_event_notes");
    expect(row).not.toHaveProperty("calendar_event_location");
  });

  it("saves all three once the leader changes the section", async () => {
    const { container, submit } = await mount();
    const notes = container.querySelector<HTMLElement>("#share-notes")!;
    await act(async () => notes.click());
    await submit();
    expect(update.mock.calls[0][0]).toMatchObject({
      calendar_meeting_details: false,
      calendar_event_notes: false,
      calendar_event_location: false,
    });
  });

  it("goes back to following the group", async () => {
    const { container, submit } = await mount();
    const back = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Use the group's settings"
    )!;
    await act(async () => back.click());
    await submit();
    expect(update.mock.calls[0][0]).toMatchObject({
      calendar_meeting_details: null,
      calendar_event_notes: null,
      calendar_event_location: null,
    });
  });
});
