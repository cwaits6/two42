// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const db = vi.hoisted(() => ({
  from: vi.fn(),
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
        insert: () => chain,
        select: () => chain,
        single: () => Promise.resolve({ data: { id: "new-fund" }, error: null }),
        upsert: () => Promise.resolve({ error: db.methodError }),
        delete: () => chain,
        eq: () => chain,
        in: () => Promise.resolve({ error: null }),
      };
      return chain;
    },
  }),
}));

const { FundForm } = await import("./FundForm");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function mount(isLeader = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(FundForm, {
        fund: null,
        members: [{ id: "me", name: "Ray Park", initials: "RP", avatarUrl: null }],
        currentUserId: "me",
        isLeader,
        groupId: "group-1",
        groupName: "Group A",
        backHref: "/g/group-1/give",
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
  });
});
