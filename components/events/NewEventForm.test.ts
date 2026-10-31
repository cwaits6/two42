// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const insert = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("date=2026-11-05"),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/GoogleMapsScript", () => ({ GoogleMapsScript: () => null }));
vi.mock("@/components/events/LocationInput", () => ({
  LocationInput: ({ id, name }: { id: string; name: string }) => createElement("input", { id, name }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ insert: (row: unknown) => ({ select: () => ({ single: () => insert(row) }) }) }),
  }),
}));

const { NewEventForm } = await import("./NewEventForm");

let mounted: { root: Root; container: HTMLElement } | null = null;

beforeEach(() => {
  push.mockReset();
  insert.mockReset();
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
    root.render(
      createElement(NewEventForm, {
        groupId: "g1",
        groupName: "Group",
        orgId: "o1",
        calendarId: "c1",
        timeZone: "America/Chicago",
      })
    )
  );
  const input = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;
  const type = async (id: string, value: string) => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    await act(async () => el.dispatchEvent(new Event("input", { bubbles: true })));
  };
  const submit = () =>
    act(async () =>
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    );
  return { input, type, submit };
}

describe("NewEventForm", () => {
  it("lands on the new event after it is added", async () => {
    insert.mockResolvedValue({ data: { id: "e1" }, error: null });
    const { type, submit } = await mount();
    await type("title", "Supper");
    await submit();
    expect(insert).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/g/g1/calendar/e1");
  });

  it("stays on the form and says so when the insert fails", async () => {
    insert.mockResolvedValue({ data: null, error: { message: "denied" } });
    const { type, submit } = await mount();
    await type("title", "Supper");
    await submit();
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("moves focus to the end time when it is before the start, without saving", async () => {
    const { input, type, submit } = await mount();
    await type("title", "Supper");
    await type("end_time", "2026-11-05T08:00");
    await submit();
    expect(insert).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input("end_time"));
    expect(input("end_time").getAttribute("aria-invalid")).toBe("true");
  });
});
