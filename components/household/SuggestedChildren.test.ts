// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { SuggestedChildren, childDetails } = await import("./SuggestedChildren");

const LILY = { id: "s-1", first_name: "Lily", last_name: "Mockingham", birth_month: 3, birth_day: 3, graduation_year: 2034 };
const TODAY = new Date(Date.UTC(2026, 10, 26));

let root: Root | undefined;
async function mount(suggestions = [LILY]) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(SuggestedChildren, { suggestions, today: TODAY })));
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("SuggestedChildren", () => {
  it("renders nothing without suggestions", async () => {
    await mount([]);
    expect(document.body.textContent).toBe("");
  });

  it("shows the birthday without a year, and the grade", () => {
    expect(childDetails(LILY, TODAY)).toEqual(["Birthday March 3", "5th grade"]);
    expect(childDetails({ ...LILY, birth_month: null, birth_day: null, graduation_year: null }, TODAY)).toEqual([]);
  });

  it("adds a child through the household's own request", async () => {
    await mount();
    await act(async () => button("Add to household").click());
    expect(rpc).toHaveBeenCalledWith("records_add_suggested_child", { _suggestion_id: "s-1" });
    expect(toast.success).toHaveBeenCalledWith("Added Lily to your household.");
    expect(refresh).toHaveBeenCalled();
  });

  it("asks before dismissing, then dismisses", async () => {
    await mount();
    await act(async () => button("Dismiss").click());
    expect(rpc).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("two42 won't suggest them again.");
    const confirm = [...document.querySelectorAll("button")].filter((b) => b.textContent === "Dismiss").at(-1)!;
    await act(async () => confirm.click());
    expect(rpc).toHaveBeenCalledWith("records_dismiss_suggested_child", { _suggestion_id: "s-1" });
  });

  it("says a suggestion decided elsewhere is no longer available", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "RC001", message: "" } });
    await mount();
    await act(async () => button("Add to household").click());
    expect(toast.error).toHaveBeenCalledWith("This suggestion is no longer available.");
  });
});
