// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyMember, FamilyMemberRelationship } from "@/lib/types";

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

const { useRelabelToChild } = await import("./useRelabelToChild");

type Member = Pick<FamilyMember, "id" | "relationship" | "birth_year" | "claimed_profile_id">;

const SPOUSE: Member = { id: "m1", relationship: "spouse", birth_year: 1990, claimed_profile_id: null };
const NOTHING_TO_LOSE: Member = { ...SPOUSE, birth_year: null };

const save = vi.fn<() => Promise<boolean>>();
const setSaving = vi.fn<(saving: boolean) => void>();

let root: Root;
let submit: () => Promise<void>;

async function mount(member: Member | null, relationship: FamilyMemberRelationship = "child") {
  function Harness() {
    const relabel = useRelabelToChild({ member, relationship, name: "Liam", setSaving, save });
    submit = relabel.submit;
    return relabel.dialog;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
}

async function click(name: string) {
  const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? null;
const submitted = () => act(async () => submit());

beforeEach(() => {
  invites.rows = [];
  invites.error = null;
  invites.reads = 0;
  vi.clearAllMocks();
  save.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("useRelabelToChild", () => {
  it("saves a new person without reading invites or asking", async () => {
    await mount(null);
    await submitted();
    expect(invites.reads).toBe(0);
    expect(setSaving).not.toHaveBeenCalled();
    expect(dialogText()).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Member, FamilyMemberRelationship]>([
    ["stays an adult", SPOUSE, "sibling"],
    ["is already a child without an account", { ...NOTHING_TO_LOSE, relationship: "child" }, "child"],
    ["has an account", { ...SPOUSE, claimed_profile_id: "p1" }, "child"],
  ])("saves without asking when the person %s", async (_case, member, relationship) => {
    await mount(member, relationship);
    await submitted();
    expect(invites.reads).toBe(0);
    expect(dialogText()).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("saves without asking when there's no year and no open invite", async () => {
    await mount(NOTHING_TO_LOSE);
    await submitted();
    expect(invites.reads).toBe(1);
    expect(dialogText()).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Member, { id: string }[], string]>([
    ["a year", SPOUSE, [], "Saving deletes Liam's birth year. This can't be undone."],
    [
      "an open invite",
      NOTHING_TO_LOSE,
      [{ id: "i1" }],
      "Saving deletes Liam's open invite. The invite link stops working. This can't be undone.",
    ],
    [
      "both",
      SPOUSE,
      [{ id: "i1" }],
      "Saving deletes Liam's birth year and open invite. The invite link stops working. This can't be undone.",
    ],
  ])("names %s, and saves nothing until confirmed", async (_case, member, rows, sentence) => {
    invites.rows = rows;
    await mount(member);
    await submitted();

    expect(dialogText()).toContain("Change Liam to Child?");
    expect(dialogText()).toContain(sentence);
    expect(save).not.toHaveBeenCalled();

    await click("Change to Child");
    expect(save).toHaveBeenCalledTimes(1);
    expect(dialogText()).toBeNull();
  });

  it("marks the form busy only while it reads the invite", async () => {
    await mount(SPOUSE);
    await submitted();
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it("saves nothing on cancel, and asks again on the next submit", async () => {
    await mount(SPOUSE);
    await submitted();
    await click("Cancel");
    expect(save).not.toHaveBeenCalled();
    expect(dialogText()).toBeNull();

    await submitted();
    expect(dialogText()).toContain("Change Liam to Child?");
    expect(save).not.toHaveBeenCalled();
  });

  it("stays open when the save fails, so it can be retried", async () => {
    save.mockResolvedValueOnce(false);
    await mount(SPOUSE);
    await submitted();

    await click("Change to Child");
    expect(dialogText()).toContain("Change Liam to Child?");

    await click("Change to Child");
    expect(save).toHaveBeenCalledTimes(2);
    expect(dialogText()).toBeNull();
  });

  it("neither saves nor asks when the invite can't be read", async () => {
    invites.error = { code: "500" };
    await mount(NOTHING_TO_LOSE);
    await submitted();

    expect(save).not.toHaveBeenCalled();
    expect(dialogText()).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(setSaving.mock.calls).toEqual([[true], [false]]);
  });
});
