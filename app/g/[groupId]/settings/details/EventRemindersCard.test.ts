// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const upsert = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ upsert: (row: unknown) => ({ select: () => upsert(row) }) }),
  }),
}));

const { EventRemindersCard } = await import("./EventRemindersCard");

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  upsert.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

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
    root.render(createElement(EventRemindersCard, { groupId: "g1", initial: { enabled: true, defaultDays: 2 } }))
  );
  // The id is on the switch's own checkbox input.
  const toggle = container.querySelector<HTMLInputElement>("#event_reminders_enabled")!;
  return { toggle, isOn: () => toggle.checked };
}

describe("EventRemindersCard", () => {
  it("turns the group's reminders off and says so", async () => {
    upsert.mockResolvedValue({ data: [{ group_id: "g1" }], error: null });
    const { toggle, isOn } = await mount();
    await act(async () => toggle.click());
    expect(upsert.mock.calls[0][0]).toMatchObject({ group_id: "g1", event_reminders_enabled: false });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty("event_reminder_default_days");
    expect(isOn()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Event reminders are off for this group.");
  });

  it("goes back and says so when the save changes no row", async () => {
    upsert.mockResolvedValue({ data: [], error: null });
    const { toggle, isOn } = await mount();
    await act(async () => toggle.click());
    expect(isOn()).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("goes back and says so when the save fails", async () => {
    upsert.mockResolvedValue({ data: null, error: { message: "denied" } });
    const { toggle, isOn } = await mount();
    await act(async () => toggle.click());
    expect(isOn()).toBe(true);
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
