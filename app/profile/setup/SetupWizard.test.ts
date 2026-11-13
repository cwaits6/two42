// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const writes: { table: string; values: Record<string, unknown>; column: string; id: string }[] = [];
const failing: { table?: string } = {};
// What the claimed household record still holds after the clear.
const claimed: { kept: { id: string }[] } = { kept: [] };
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (column: string, id: string) => {
          writes.push({ table, values, column, id });
          return { error: table === failing.table ? { code: "XX000" } : null };
        },
      }),
      select: () => ({
        eq: (column: string, id: string) => ({
          not: () => ({
            limit: async () => ({
              data: column === "claimed_profile_id" && id === "p1" ? claimed.kept : [],
              error: null,
            }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
    }),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrl: vi.fn(), uploadImage: vi.fn() }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { SetupWizard } = await import("./SetupWizard");

const PROFILE = {
  id: "p1",
  first_name: "Ada",
  last_name: "Lovelace",
  family_id: "f1",
  birth_month: 12,
  birth_day: 10,
  birth_year: 1990,
} as Profile;

let root: Root;

async function mount(profile: Profile = PROFILE) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(SetupWizard, {
        profile,
        userEmail: "ada@example.test",
        householdName: "Lovelace Family",
      }),
    );
  });
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
async function click(name: string) {
  const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}
async function choose(id: string, option: string) {
  await act(async () => field(id).click());
  const found = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === option);
  if (!found) throw new Error(`No option ${option}`);
  await act(async () => (found as HTMLElement).click());
}
async function type(id: string, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(field(id), value);
    field(id).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  writes.length = 0;
  failing.table = undefined;
  claimed.kept = [];
  vi.clearAllMocks();
  vi.stubGlobal("scrollTo", () => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("finishing the setup wizard", () => {
  it("sends no retired hide setting with the values they covered", async () => {
    await mount({ ...PROFILE, birth_month: null, birth_day: null, birth_year: null });
    await click("Continue");
    await type("phone_mobile", "(512) 555-0199");
    await click("Continue");
    await click("Continue");
    await type("occupation", "Teacher");
    await click("Finish setup");

    const profileWrite = writes.find((w) => w.table === "profiles")!;
    expect(profileWrite.values).toMatchObject({ phone_mobile: "+15125550199", occupation: "Teacher" });
    expect(Object.keys(profileWrite.values).filter((k) => k.startsWith("hide_"))).toEqual(["hide_email"]);
  });
});

describe("choosing No date in the setup wizard", () => {
  it("clears the whole birthday, on the profile and the household record it claimed", async () => {
    await mount();
    await choose("birth_month", "No date");

    expect(field("birth_day").value).toBe("");
    expect(field("birth_year").value).toBe("");

    await click("Continue");
    await click("Continue");
    await click("Continue");
    await click("Finish setup");

    const cleared = { birth_month: null, birth_day: null, birth_year: null };
    expect(writes[0]).toEqual({ table: "family_members", values: cleared, column: "claimed_profile_id", id: "p1" });
    expect(writes[1]).toMatchObject({ table: "profiles", values: cleared, id: "p1" });
    expect(toast.success).toHaveBeenCalledWith("Profile set up.");
  });

  it("leaves the claimed household record alone when the profile had no birthday to clear", async () => {
    await mount({ ...PROFILE, birth_month: null, birth_day: null, birth_year: null });
    await click("Continue");
    await click("Continue");
    await click("Continue");
    await click("Finish setup");

    expect(writes.map((w) => w.table)).toEqual(["profiles", "profiles"]);
    expect(toast.success).toHaveBeenCalledWith("Profile set up.");
  });

  it("doesn't write the profile when the claimed household record's birthday can't be cleared", async () => {
    failing.table = "family_members";
    await mount();
    await choose("birth_month", "No date");
    await click("Continue");
    await click("Continue");
    await click("Continue");
    await click("Finish setup");

    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(writes.map((w) => w.table)).toEqual(["family_members"]);
  });

  it("finishes setup and says the household still lists the birthday when the record's clear wrote nothing", async () => {
    claimed.kept = [{ id: "fm1" }];
    await mount();
    await choose("birth_month", "No date");
    await click("Continue");
    await click("Continue");
    await click("Continue");
    await click("Finish setup");

    expect(toast.info).toHaveBeenCalledWith(
      "Profile set up. The household still lists this birthday. A church admin can remove it.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(writes.some((w) => "setup_completed" in w.values)).toBe(true);
  });

  it("leaves the claimed household record alone when the birthday is kept", async () => {
    await mount();
    await click("Continue");
    await click("Continue");
    await click("Continue");
    await click("Finish setup");

    expect(writes.map((w) => w.table)).toEqual(["profiles", "profiles"]);
  });

  it("clears the whole anniversary, and writes none", async () => {
    await mount();
    await click("Continue");
    await click("Continue");
    await click("Add spouse");
    await type("add_first_name", "Grace");
    await click("Add spouse");
    await choose("anniversary_month", "October");
    await type("anniversary_day", "3");
    await type("anniversary_year", "2009");
    await choose("anniversary_month", "No date");

    expect(field("anniversary_day").value).toBe("");
    expect(field("anniversary_year").value).toBe("");

    await click("Continue");
    await click("Finish setup");

    expect(writes.some((w) => w.table === "family_units")).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Profile set up.");
  });
});
