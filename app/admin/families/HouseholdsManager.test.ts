// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({
  loadError: null as { code: string } | null,
  members: [] as Record<string, unknown>[],
  families: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  invites: [] as { id: string }[],
}));

const FAMILY = {
  id: "f1",
  family_name: "Test",
  photo_url: null,
  org_id: "o1",
  anniversary_month: 10,
  anniversary_day: 3,
  anniversary_year: 2009,
  address_line1: "12 Elm St",
  city: "Austin",
};
const householdUpdate = vi.hoisted(() => vi.fn());
const TABLES = { family_units: "families", family_members: "members", profiles: "profiles" } as const;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        not: () => chain,
        delete: () => ({ eq: async () => ({ error: null }) }),
        update: (values: unknown) => {
          householdUpdate(values);
          return { eq: async () => ({ error: null }) };
        },
        is: () => chain,
        limit: async () => ({ data: state.invites, error: null }),
        then: (resolve: (value: unknown) => void) =>
          resolve({
            data: table in TABLES ? state[TABLES[table as keyof typeof TABLES]] : [],
            error: state.loadError,
          }),
      };
      return chain;
    },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));

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
  state.families = [FAMILY];
  state.profiles = [];
  state.invites = [];
  fetchMock.mockClear();
  householdUpdate.mockClear();
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
  it("lists each household once with its address and the people in it, and finds one by a member's name", async () => {
    state.families = [FAMILY, { id: "f2", family_name: "Park", photo_url: null, org_id: "o1" }];
    state.profiles = [{ id: "p1", first_name: "Nia", last_name: "Brook", preferred_name: null, family_id: "f1" }];
    await mount();

    const rows = () => [...host.querySelectorAll("tbody tr")];
    expect(rows()).toHaveLength(2);
    const [park, test] = rows().sort((a, b) => a.textContent!.localeCompare(b.textContent!));
    expect(test.textContent).toContain("12 Elm St, Austin");
    expect(test.querySelector('a[href="/admin/members/p1"]')?.textContent).toBe("Nia Brook");
    expect(park.textContent).toContain("No members");

    const field = host.querySelector<HTMLInputElement>("#household-search")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(field, "nia");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.textContent).toContain("1 of 2 households");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("Test");
  });

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

  describe("choosing No date", () => {
    it("clears a household's whole anniversary", async () => {
      await mount();
      await click("Edit Test");
      await click("No date");
      await click("Save changes");

      expect(householdUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ anniversary_month: null, anniversary_day: null, anniversary_year: null }),
      );
      expect(toast.success).toHaveBeenCalledWith("Household saved.");
    });

    it("clears a person's whole birthday", async () => {
      state.members = [LIAM];
      await mount();
      await click("Edit Test");
      await click("Edit Liam");
      await click("No date");
      await click("Save");

      expect(savedBody()).toMatchObject({ birth_month: null, birth_day: null, birth_year: null });
      expect(toast.success).toHaveBeenCalledWith("Liam saved.");
    });
  });

  it("says where the directory's birthday is kept, only for a person with an account", async () => {
    const note = "The directory shows the birthday on Liam's profile. Change that one in Edit member.";
    state.members = [LIAM];
    await mount();
    await click("Edit Test");
    await click("Edit Liam");
    expect(dialogTexts()).not.toContain(note);
    await act(async () => root.unmount());
    document.body.innerHTML = "";

    state.members = [{ ...LIAM, claimed_profile_id: "p1" }];
    await mount();
    await click("Edit Test");
    await click("Edit Liam");
    expect(dialogTexts()).toContain(note);
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
