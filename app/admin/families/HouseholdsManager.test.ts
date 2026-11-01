// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({ loadError: null as { code: string } | null }));

const FAMILY = { id: "f1", family_name: "Test", photo_url: null, org_id: "o1" };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        not: () => chain,
        delete: () => ({ eq: async () => ({ error: null }) }),
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: table === "family_units" ? [FAMILY] : [], error: state.loadError }),
      };
      return chain;
    },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { HouseholdsManager } = await import("./HouseholdsManager");

let root: Root;
let host: HTMLDivElement;

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(HouseholdsManager));
  });
}

// The confirm dialog renders after the dialog it opens from, so the last match is on top.
async function click(name: string) {
  const found = [...document.querySelectorAll("button")].findLast(
    (b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

beforeEach(() => {
  state.loadError = null;
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("HouseholdsManager", () => {
  it("says so when the list can't be re-read after a delete", async () => {
    await mount();
    await click("Edit Test");
    await click("Delete household");
    state.loadError = { code: "XX000" };
    await click("Delete household");

    expect(toast.success).toHaveBeenCalledWith("Household deleted.");
    expect(toast.error).toHaveBeenCalledWith("Couldn't load the latest households. Try again.");
  });

  it("shows the error state, not a toast, when the first load fails", async () => {
    state.loadError = { code: "XX000" };
    await mount();
    expect(host.textContent).toContain("Couldn't load");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
