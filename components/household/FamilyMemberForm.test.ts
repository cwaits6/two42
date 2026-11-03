// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyMember, FamilyUnit } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const invites = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  error: null as { code: string } | null,
  reads: 0,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        limit: async () => {
          invites.reads++;
          return { data: invites.error ? null : invites.rows, error: invites.error };
        },
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/uploadImage", () => ({ mintSignedUrl: async () => "", uploadImage: async () => "" }));

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

const { FamilyMemberForm } = await import("./FamilyMemberForm");

const FAMILY = { id: "f1", family_name: "Mockingham" } as FamilyUnit;
const ADULT = {
  id: "m1",
  family_id: "f1",
  first_name: "Liam",
  last_name: "Mockingham",
  preferred_name: null,
  relationship: "spouse",
  birth_month: 8,
  birth_day: 12,
  birth_year: 1989,
  is_class_member: false,
  avatar_url: null,
  claimed_profile_id: null,
} as FamilyMember;

let root: Root;
const onSaved = vi.fn();
const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

async function mount(member: FamilyMember) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(FamilyMemberForm, { member, family: FAMILY, onSaved }));
  });
}

async function click(name: string) {
  const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? null;
const savedBody = () => JSON.parse((fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1].body as string);

beforeEach(() => {
  invites.rows = [];
  invites.error = null;
  invites.reads = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("relabelling someone to Child", () => {
  it("names the year, and saves nothing until confirmed", async () => {
    await mount(ADULT);
    await click("Child");
    await click("Save changes");

    expect(dialogText()).toContain("Change Liam to Child?");
    expect(dialogText()).toContain("Saving deletes Liam's birth year. This can't be undone.");
    expect(fetchMock).not.toHaveBeenCalled();

    await click("Change to Child");
    expect(savedBody()).toMatchObject({ relationship: "child", birth_year: null });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("names an open invite and what happens to its link", async () => {
    invites.rows = [{ id: "i1" }];
    await mount({ ...ADULT, birth_year: null });
    await click("Child");
    await click("Save changes");

    expect(dialogText()).toContain(
      "Saving deletes Liam's open invite. The invite link stops working. This can't be undone.",
    );
  });

  it("names both when both go", async () => {
    invites.rows = [{ id: "i1" }];
    await mount(ADULT);
    await click("Child");
    await click("Save changes");

    expect(dialogText()).toContain("Saving deletes Liam's birth year and open invite.");
  });

  it("changes nothing on cancel, and asks again on the next save", async () => {
    await mount(ADULT);
    await click("Child");
    await click("Save changes");
    await click("Cancel");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    await click("Spouse");
    await click("Save changes");
    expect(savedBody()).toMatchObject({ relationship: "spouse", birth_year: 1989 });
  });

  it("leaves the dialog open when the save fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await mount(ADULT);
    await click("Child");
    await click("Save changes");
    await click("Change to Child");

    expect(toast.error).toHaveBeenCalledWith("Couldn't save Liam. Try again.");
    expect(dialogText()).toContain("Change Liam to Child?");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves directly when there's no year and no open invite", async () => {
    await mount({ ...ADULT, birth_year: null });
    await click("Child");
    await click("Save changes");

    expect(dialogText()).toBeNull();
    expect(savedBody()).toMatchObject({ relationship: "child" });
  });

  it("doesn't save when the invite can't be read", async () => {
    invites.error = { code: "XX000" };
    await mount({ ...ADULT, birth_year: null });
    await click("Child");
    await click("Save changes");

    expect(toast.error).toHaveBeenCalledWith("Couldn't save Liam. Try again.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["someone staying an adult", ADULT],
    ["someone already a child", { ...ADULT, relationship: "child", birth_year: null }],
    ["a child with an account", { ...ADULT, relationship: "child", claimed_profile_id: "p1" }],
  ] as [string, FamilyMember][])("doesn't ask about %s", async (_label, member) => {
    invites.rows = [{ id: "i1" }];
    await mount(member);
    await click("Save changes");

    expect(dialogText()).toBeNull();
    expect(invites.reads).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("the year's validation error", () => {
  it("goes when the year field does", async () => {
    await mount({ ...ADULT, birth_year: null });
    const year = document.getElementById("birth_year") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(year, "1800");
      year.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save changes");
    expect(document.body.textContent).toContain("Enter a year from 1900");

    await click("Child");
    expect(document.getElementById("birth_year")).toBeNull();
    expect(document.body.textContent).not.toContain("Enter a year from 1900");
  });

  it("takes the month and day errors the year caused with it", async () => {
    await mount({ ...ADULT, birth_month: 2, birth_day: 29, birth_year: 2023 });
    await click("Save changes");
    expect(document.body.textContent).toContain("Enter a day from 1 to 28.");
    await click("Child");
    expect(document.body.textContent).not.toContain("Enter a day from");
    await act(async () => root.unmount());

    await mount({ ...ADULT, birth_month: null, birth_day: null, birth_year: 1980 });
    await click("Save changes");
    expect(document.body.textContent).toContain("Choose the month of the birthday.");
    await click("Child");
    expect(document.body.textContent).not.toContain("Choose the month of the birthday.");
    expect(document.body.textContent).not.toContain("Enter the day of the birthday.");
  });

  it("keeps a day error the year didn't cause", async () => {
    await mount({ ...ADULT, birth_month: 2, birth_day: 31, birth_year: 2023 });
    await click("Save changes");
    await click("Child");
    expect(document.body.textContent).toContain("Enter a day from 1 to 29.");
  });
});
