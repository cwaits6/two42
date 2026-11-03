// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({
  loadError: null as { code: string } | null,
  members: [] as Record<string, unknown>[],
  invites: [] as { id: string }[],
}));

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
        is: () => chain,
        limit: async () => ({ data: state.invites, error: null }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: table === "family_units" ? [FAMILY] : table === "family_members" ? state.members : [],
            error: state.loadError,
          }),
      };
      return chain;
    },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

// Each option a plain button: the Base UI popup isn't what these tests are about.
vi.mock("@/components/ui/select", async () => {
  const { createElement: h, Fragment } = await import("react");
  return {
    Select: ({
      items,
      onValueChange,
    }: {
      items: { value: string; label: string }[];
      onValueChange: (value: string) => void;
    }) =>
      h(
        Fragment,
        null,
        items.map((item) =>
          h("button", { key: item.value, type: "button", onClick: () => onValueChange(item.value) }, item.label),
        ),
      ),
    SelectContent: ({ children }: { children: ReactNode }) => children,
    SelectItem: ({ children }: { children: ReactNode }) => children,
    SelectTrigger: ({ children }: { children: ReactNode }) => children,
    SelectValue: () => null,
  };
});

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

const LIAM = {
  id: "m1",
  first_name: "Liam",
  last_name: "Test",
  relationship: "spouse",
  birth_month: 8,
  birth_day: 12,
  birth_year: 1989,
  claimed_profile_id: null,
};
const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
const dialogTexts = () => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent).join();
const savedBody = () => JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);

beforeEach(() => {
  state.loadError = null;
  state.members = [];
  state.invites = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
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

  describe("relabelling someone to Child", () => {
    async function relabelLiam(member = LIAM) {
      state.members = [member];
      await mount();
      await click("Edit Test");
      await click("Edit Liam");
      await click("Child");
      await click("Save");
    }

    it("names what goes, and changes nothing on cancel", async () => {
      state.invites = [{ id: "i1" }];
      await relabelLiam();

      expect(dialogTexts()).toContain("Saving deletes Liam's birth year and open invite.");
      expect(fetchMock).not.toHaveBeenCalled();

      await click("Cancel");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(dialogTexts()).not.toContain("Change Liam to Child?");
    });

    it("saves once confirmed", async () => {
      await relabelLiam();
      await click("Change to Child");

      expect(savedBody()).toMatchObject({ relationship: "child", birth_year: null });
      expect(toast.success).toHaveBeenCalledWith("Liam saved.");
    });

    it("saves directly when there's no year and no open invite", async () => {
      await relabelLiam({ ...LIAM, birth_year: null as unknown as number });

      expect(dialogTexts()).not.toContain("Change Liam to Child?");
      expect(savedBody()).toMatchObject({ relationship: "child" });
    });
  });

  it("clears the year's validation error when the year field goes", async () => {
    state.members = [{ ...LIAM, birth_year: 1800 }];
    await mount();
    await click("Edit Test");
    await click("Edit Liam");
    await click("Save");
    expect(document.body.textContent).toContain("Enter a year from 1900");

    await click("Child");
    expect(document.getElementById("fm_birth_year")).toBeNull();
    expect(document.body.textContent).not.toContain("Enter a year from 1900");
  });

  it("clears the month and day errors the year caused when the year field goes", async () => {
    state.members = [{ ...LIAM, birth_month: 2, birth_day: 29, birth_year: 2023 }];
    await mount();
    await click("Edit Test");
    await click("Edit Liam");
    await click("Save");
    expect(document.body.textContent).toContain("Enter a day from 1 to 28.");

    await click("Child");
    expect(document.body.textContent).not.toContain("Enter a day from");
  });

  it("keeps a day error the year didn't cause", async () => {
    state.members = [{ ...LIAM, birth_month: 2, birth_day: 31, birth_year: 2023 }];
    await mount();
    await click("Edit Test");
    await click("Edit Liam");
    await click("Save");
    await click("Child");
    expect(document.body.textContent).toContain("Enter a day from 1 to 29.");
  });

  it("shows the error state, not a toast, when the first load fails", async () => {
    state.loadError = { code: "XX000" };
    await mount();
    expect(host.textContent).toContain("Couldn't load");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
