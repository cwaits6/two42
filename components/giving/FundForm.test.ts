// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const db = vi.hoisted(() => ({
  from: vi.fn(),
  inserted: vi.fn(),
  updated: vi.fn(),
  methodError: null as { message: string } | null,
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => db.router }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      db.from(table);
      const chain = {
        insert: (row: unknown) => {
          db.inserted(row);
          return chain;
        },
        update: (patch: unknown) => {
          db.updated(patch);
          return chain;
        },
        select: () => chain,
        single: () => Promise.resolve({ data: { id: "new-fund" }, error: null }),
        upsert: () => Promise.resolve({ error: db.methodError }),
        delete: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ error: null }),
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve(resolve({ data: [{ id: "fund-1" }], error: null })),
      };
      return chain;
    },
  }),
}));

const { FundForm } = await import("./FundForm");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const RAY = { id: "me", name: "Ray Park", initials: "RP", avatarUrl: null };

function storedFund(fund: {
  is_active: boolean;
  retire_on: string | null;
  steward_id?: string | null;
  needs_review?: boolean;
}) {
  return {
    id: "fund-1",
    name: "Building fund",
    description: null,
    steward_id: "me",
    co_steward_id: null,
    steward_role: null,
    methods: [{ method: "zelle", custom_handle: "fund@example.test" }],
    ...fund,
  } as unknown as ComponentProps<typeof FundForm>["fund"];
}

async function mount({
  isLeader = true,
  fund = null,
  members = [RAY],
}: Partial<Pick<ComponentProps<typeof FundForm>, "isLeader" | "fund" | "members">> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(FundForm, {
        fund,
        members,
        currentUserId: "me",
        isLeader,
        groupId: "group-1",
        groupName: "Group A",
        backHref: "/g/group-1/give",
        today: "2026-11-01",
      })
    )
  );
  return container;
}

function button(label: string) {
  const match = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === label
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

const toggle = (name: string) =>
  document.querySelector<HTMLElement>(`[role="switch"][aria-label="Accept ${name}"]`)!;

function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  db.methodError = null;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("FundForm", () => {
  it("uses plain fund wording", async () => {
    const container = await mount();
    const copy = container.textContent!;
    expect(copy).toContain("Who receives it?");
    expect(copy).toContain("Goes to Ray Park");
    expect(button("Add fund")).toBeTruthy();
    expect(copy).not.toMatch(/steward|co-collector|handle|collection|Create fund|Auto-retire/i);
  });

  it("ties the labels to the people pickers", async () => {
    await mount();
    expect(document.querySelector('label[for="fund-recipient"]')?.textContent).toBe(
      "Who receives it?"
    );
    expect(document.getElementById("fund-recipient")?.tagName).toBe("INPUT");
    expect(document.getElementById("fund-second-person")?.tagName).toBe("INPUT");
  });

  it("says in words whether each payment method is on or off", async () => {
    await mount();
    const row = () => toggle("Venmo").parentElement!;
    expect(row().textContent).toContain("Off");
    await act(async () => toggle("Venmo").click());
    expect(row().textContent).toContain("On");
  });

  it("marks problems beside their fields and moves focus, with no toast and no write", async () => {
    await mount();
    await act(async () => button("Add fund").click());

    const name = document.getElementById("fund-name")!;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("fund-name-error")?.textContent).toBe("Enter a fund name.");
    expect(document.activeElement).toBe(name);
    expect(document.body.textContent).toContain("Turn on at least one payment method.");
    expect(toast.error).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("clears a method's message once the method changes", async () => {
    await mount();
    await act(async () => toggle("Zelle").click());
    await act(async () => button("Add fund").click());
    expect(document.body.textContent).toContain("Enter the Zelle account, or turn Zelle off.");
    await act(async () => toggle("Zelle").click());
    expect(document.body.textContent).not.toContain("Enter the Zelle account");
  });

  it("moves to the edit route when a new fund's methods fail, so retrying can't add it twice", async () => {
    db.methodError = { message: "denied" };
    await mount();
    await act(async () => type("fund-name", "Building fund"));
    await act(async () => toggle("Zelle").click());
    await act(async () => type("fund-method-zelle", "fund@example.test"));
    await act(async () => button("Add fund").click());
    expect(toast.error).toHaveBeenCalledWith(
      "Fund saved, but couldn't save its payment methods. Try again."
    );
    expect(db.router.replace).toHaveBeenCalledWith("/g/group-1/give/new-fund/edit");
    expect(db.router.push).not.toHaveBeenCalled();

    const saving = button("Saving…");
    expect(saving.disabled).toBe(true);
    await act(async () => saving.click());
    expect(db.inserted).toHaveBeenCalledTimes(1);
  });

  it("can't add a second fund while moving away after a save", async () => {
    await mount();
    await act(async () => type("fund-name", "Building fund"));
    await act(async () => toggle("Zelle").click());
    await act(async () => type("fund-method-zelle", "fund@example.test"));
    await act(async () => button("Add fund").click());
    expect(db.router.push).toHaveBeenCalledWith("/g/group-1/give");
    expect(button("Saving…").disabled).toBe(true);
  });

  it("lets an existing fund retry when its methods fail, staying on the page", async () => {
    db.methodError = { message: "denied" };
    await mount({ fund: storedFund({ is_active: true, retire_on: null }) });
    await act(async () => button("Save changes").click());
    expect(toast.error).toHaveBeenCalled();
    expect(db.router.replace).not.toHaveBeenCalled();
    expect(button("Save changes").disabled).toBe(false);
  });

  it("offers to retire a live fund, leaving its last day alone", async () => {
    await mount({ fund: storedFund({ is_active: true, retire_on: "2027-01-01" }) });
    await act(async () => button("Retire fund").click());
    expect(db.updated).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    expect(db.updated.mock.calls[0][0]).not.toHaveProperty("retire_on");
    expect(toast.success).toHaveBeenCalledWith("Fund retired.");
  });

  it.each([true, false])(
    "reopens a fund past its last day by clearing the date (is_active %s)",
    async (is_active) => {
      await mount({ fund: storedFund({ is_active, retire_on: "2026-10-31" }) });
      expect(document.body.textContent).not.toContain("Retire fund");
      await act(async () => button("Reopen fund").click());
      expect(db.updated).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: true, retire_on: null })
      );
      expect(toast.success).toHaveBeenCalledWith("Fund reopened.");
    }
  );

  it("keeps a last day still to come when reopening a retired fund", async () => {
    await mount({ fund: storedFund({ is_active: false, retire_on: "2027-01-01" }) });
    await act(async () => button("Reopen fund").click());
    expect(db.updated).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true, retire_on: "2027-01-01" })
    );
  });

  describe("a fund waiting on a leader", () => {
    const LIVE = { is_active: true, retire_on: null };
    const BEN = { id: "ben", name: "Ben Lee", initials: "BL", avatarUrl: null };
    const inReview = storedFund({ ...LIVE, steward_id: "ben", needs_review: true });
    const noRecipient = storedFund({ ...LIVE, steward_id: null, needs_review: true });

    function field(id: string) {
      return document.getElementById(id) as HTMLInputElement;
    }

    it("opens with no recipient chosen, never the person editing, and requires one", async () => {
      await mount({ fund: noRecipient, members: [RAY, BEN] });
      expect(document.body.textContent).toContain("Needs a recipient");
      expect(field("fund-recipient").value).toBe("");
      await act(async () => button("Save changes").click());
      expect(field("fund-recipient").getAttribute("aria-invalid")).toBe("true");
      expect(db.updated).not.toHaveBeenCalled();
    });

    it("won't confirm with no recipient chosen", async () => {
      await mount({ fund: noRecipient, members: [RAY, BEN] });
      await act(async () => button("Confirm fund").click());
      expect(document.activeElement).toBe(field("fund-recipient"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("saving leaves the flag alone", async () => {
      await mount({ fund: inReview, members: [RAY, BEN] });
      await act(async () => button("Save changes").click());
      expect(db.updated).toHaveBeenCalledTimes(1);
      expect(db.updated.mock.calls[0][0]).not.toHaveProperty("needs_review");
    });

    it("shows the leader the recipient and accounts, then clears the flag after everything saves", async () => {
      await mount({ fund: inReview, members: [RAY, BEN] });
      await act(async () => button("Confirm fund").click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Ben Lee");
      expect(dialog.textContent).toContain("fund@example.test");
      expect(db.updated).not.toHaveBeenCalled();

      const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Confirm fund")!;
      await act(async () => confirm.click());
      const patches = db.updated.mock.calls.map(([patch]) => patch);
      expect(patches[0]).not.toHaveProperty("needs_review");
      expect(patches.at(-1)).toMatchObject({ needs_review: false });
      expect(toast.success).toHaveBeenCalledWith("Fund confirmed.");
    });

    it("offers a promoted recipient who isn't a leader no way to confirm", async () => {
      await mount({ isLeader: false, fund: storedFund({ ...LIVE, steward_id: "me", needs_review: true }) });
      expect(document.body.textContent).toContain("Needs review");
      expect(document.body.textContent).toContain("You can correct its payment methods.");
      expect(document.body.textContent).not.toContain("Confirm fund");
    });

    it.each([
      ["in review", { is_active: false, retire_on: null, steward_id: "ben", needs_review: true }],
      ["with no recipient", { is_active: false, retire_on: null, steward_id: null, needs_review: true }],
    ])("doesn't offer Reopen on a retired fund %s", async (_, fund) => {
      await mount({ fund: storedFund(fund), members: [RAY, BEN] });
      expect(document.body.textContent).not.toContain("Reopen fund");
    });

    it("still lets a leader retire an active fund instead of confirming it", async () => {
      await mount({ fund: inReview, members: [RAY, BEN] });
      await act(async () => button("Retire fund").click());
      expect(db.updated).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    });

    it("tells the leader a retired fund stays retired", async () => {
      await mount({
        fund: storedFund({ is_active: false, retire_on: null, steward_id: "ben", needs_review: true }),
        members: [RAY, BEN],
      });
      await act(async () => button("Confirm fund").click());
      expect(document.querySelector('[role="dialog"]')!.textContent).toContain("It stays retired");
    });
  });

  it("leaves the recipient line out of the preview when the recipient is unlisted", async () => {
    const container = await mount({ members: [] });
    expect(container.textContent).not.toContain("Goes to");
    expect(container.textContent).toContain("How members see it");
  });
});
