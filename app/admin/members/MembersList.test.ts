// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({
  profiles: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
  loadError: null as { code: string } | null,
  updates: [] as { table: string; values: unknown }[],
  updateResult: { data: [{ id: "row" }], error: null } as {
    data: { id: string }[] | null;
    error: { code: string } | null;
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "me" } } }),
    },
    from: (table: string) => {
      const rows = table === "profiles" ? state.profiles : state.requests;
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: () => chain,
        update: (values: unknown) => {
          state.updates.push({ table, values });
          return {
            eq: () => ({
              select: async () => state.updateResult,
              eq: () => ({ select: async () => state.updateResult }),
            }),
          };
        },
        then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: state.loadError }),
      };
      return chain;
    },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { MembersList } = await import("./MembersList");

const profile = (id: string, first: string, role: string) => ({
  id,
  first_name: first,
  last_name: "Test",
  preferred_name: null,
  email: `${first.toLowerCase()}@example.test`,
  role,
});

let root: Root;
let host: HTMLDivElement;

async function mount(tab: "members" | "requests" = "members") {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MembersList, { initialTab: tab, timeZone: "America/Chicago" }));
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent)?.trim() === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const click = (name: string) => act(async () => button(name).click());

beforeEach(() => {
  state.profiles = [profile("me", "Ada", "admin"), profile("you", "Ben", "member")];
  state.requests = [];
  state.loadError = null;
  state.updates = [];
  state.updateResult = { data: [{ id: "row" }], error: null };
  toast.success.mockClear();
  toast.error.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("MembersList", () => {
  it("opens on Members with readable roles and no raw values", async () => {
    await mount();
    expect(host.textContent).toContain("Members (2)");
    expect(host.textContent).toContain("Church admin");
    expect(host.textContent).not.toMatch(/(?<!church )\badmin\b/i);
  });

  it("asks before moving someone to pending, and saves only once confirmed", async () => {
    await mount();
    await click("Move Ben Test to pending");
    expect(state.updates).toEqual([]);
    expect(document.body.textContent).toContain("Move Ben Test back to pending?");

    await click("Move to pending");
    expect(state.updates).toEqual([{ table: "profiles", values: { role: "pending" } }]);
    expect(toast.success).toHaveBeenCalledWith("Role changed.");
  });

  it("says why when the database refuses to demote the last church admin", async () => {
    state.updateResult = { data: null, error: { code: "CA001" } };
    await mount();
    await click("Move Ben Test to pending");
    await click("Move to pending");
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't change this role. A church needs at least one church admin.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says so when the list can't be re-read after a saved change", async () => {
    await mount();
    state.loadError = { code: "XX000" };
    await click("Move Ben Test to pending");
    await click("Move to pending");
    expect(toast.success).toHaveBeenCalledWith("Role changed.");
    expect(toast.error).toHaveBeenCalledWith("Couldn't load the latest members. Try again.");
  });

  it("shows the error state, not a toast, when the first load fails", async () => {
    state.loadError = { code: "XX000" };
    await mount();
    expect(host.textContent).toContain("Couldn't load");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not report a role change that matched no row", async () => {
    state.updateResult = { data: [], error: null };
    await mount();
    await click("Move Ben Test to pending");
    await click("Move to pending");
    expect(toast.error).toHaveBeenCalledWith("Couldn't change this role. Try again.");
  });

  it("locks the viewer's own role and offers them no move to pending", async () => {
    await mount();
    expect(host.textContent).toContain("A church needs at least one church admin");
    expect(() => button("Move Ada Test to pending")).toThrow();
  });

  it("filters what is loaded by name or email", async () => {
    await mount();
    const search = host.querySelector<HTMLInputElement>("#member-search")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(search, "ben@");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("1 of 2 members");
    expect(host.textContent).toContain("Ben Test");
    expect(host.textContent).not.toContain("Ada Test");
  });

  it("sends Approve once however many times it is pressed", async () => {
    state.requests = [
      {
        id: "r1",
        name: "Cy Park",
        email: "cy@example.test",
        message: null,
        status: "pending",
        created_at: "2026-10-01T12:00:00Z",
      },
    ];
    let settle: (response: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((resolve) => (settle = resolve)));
    vi.stubGlobal("fetch", fetchMock);

    await mount("requests");
    await click("Approve");
    expect(button("Approve").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(true);
    await click("Approve");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => settle({ ok: true, status: 200 }));
    expect(toast.success).toHaveBeenCalledWith("Request approved.");
  });
});
