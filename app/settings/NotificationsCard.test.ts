// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const update = vi.fn();
const filters: unknown[][] = [];

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (row: unknown) => ({
        eq: (...filter: unknown[]) => {
          filters.push(filter);
          return { select: () => update(row) };
        },
      }),
    }),
  }),
}));

const { NotificationsCard } = await import("./NotificationsCard");

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  update.mockReset();
  filters.length = 0;
  vi.mocked(toast.error).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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
      createElement(NotificationsCard, {
        userId: "u1",
        initial: { email_announcements: true, email_event_reminders: true },
      })
    )
  );
  // The id is on the switch's own checkbox input.
  const control = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
  return { control, isOn: (id: string) => control(id).checked };
}

describe("NotificationsCard", () => {
  it("turns event reminders off on the person's own row and leaves announcements alone", async () => {
    update.mockResolvedValue({ data: [{ id: "u1" }], error: null });
    const { control, isOn } = await mount();
    await act(async () => control("email-event-reminders").click());
    expect(update.mock.calls[0][0]).toEqual({ email_event_reminders: false });
    expect(filters).toEqual([["id", "u1"]]);
    expect(isOn("email-event-reminders")).toBe(false);
    expect(isOn("email-announcements")).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("turns announcements off without touching event reminders", async () => {
    update.mockResolvedValue({ data: [{ id: "u1" }], error: null });
    const { control, isOn } = await mount();
    await act(async () => control("email-announcements").click());
    expect(update.mock.calls[0][0]).toEqual({ email_announcements: false });
    expect(isOn("email-event-reminders")).toBe(true);
  });

  it("goes back and says so when the save changes no row", async () => {
    update.mockResolvedValue({ data: [], error: null });
    const { control, isOn } = await mount();
    await act(async () => control("email-event-reminders").click());
    expect(isOn("email-event-reminders")).toBe(true);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("goes back and says so when the save fails", async () => {
    update.mockResolvedValue({ data: null, error: { message: "denied" } });
    const { control, isOn } = await mount();
    await act(async () => control("email-announcements").click());
    expect(isOn("email-announcements")).toBe(true);
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
