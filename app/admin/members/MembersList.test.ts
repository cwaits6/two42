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
  emailsError: null as { code: string } | null,
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
    // The address arrives by the church admin read, never on the profile rows.
    rpc: async () => ({
      data: state.profiles.map((p) => ({ profile_id: p.id, email: p.email })),
      error: state.emailsError,
    }),
    from: (table: string) => {
      const rows =
        table === "profiles" ? state.profiles.map((p) => ({ ...p, email: undefined })) : state.requests;
      const chain = {
        select: () => chain,
        order: () => chain,
        returns: () => chain,
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

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push }) }));

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

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MembersList));
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

const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];

/** Opens a person's "More actions" menu and returns what it offers. */
async function openMenu(person: string): Promise<string[]> {
  await click(`More actions for ${person}`);
  return menuItems().map((item) => item.textContent ?? "");
}

async function choose(person: string, action: string) {
  await openMenu(person);
  const item = menuItems().find((i) => i.textContent === action);
  if (!item) throw new Error(`${person}'s menu has no ${action}`);
  await act(async () => item.click());
}

async function search(text: string) {
  const field = host.querySelector<HTMLInputElement>("#member-search")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tab = (name: RegExp) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => name.test(t.textContent ?? ""))!;
const bodyRows = () => [...host.querySelectorAll("tbody tr")];

const INVITE = { id: "r1", name: "Ben Test", email: "other.ben@example.test", status: "approved", signup_token: "token" };

beforeEach(() => {
  state.profiles = [profile("me", "Ada", "admin"), profile("you", "Ben", "member")];
  state.requests = [];
  state.loadError = null;
  state.emailsError = null;
  state.updates = [];
  state.updateResult = { data: [{ id: "row" }], error: null };
  toast.success.mockClear();
  toast.error.mockClear();
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("MembersList", () => {
  it("opens on everyone, one row each, with readable roles and no raw values", async () => {
    await mount();
    expect(tab(/^All/).textContent).toBe("All (2)");
    expect(bodyRows()).toHaveLength(2);
    expect(host.textContent).toContain("Church admin");
    expect(host.textContent).not.toMatch(/(?<!church )\badmin\b/i);
  });

  it("shows nothing destructive until a row's menu is opened", async () => {
    await mount();
    expect(document.body.textContent).not.toContain("Delete account");
    expect(document.body.textContent).not.toContain("Move to pending");

    expect(await openMenu("Ben Test")).toEqual(["Edit", "Move to pending", "Delete account"]);
  });

  it("offers the viewer nothing but Edit on their own row", async () => {
    await mount();
    expect(await openMenu("Ada Test")).toEqual(["Edit"]);
  });

  it("asks before moving someone to pending, and saves only once confirmed", async () => {
    await mount();
    await choose("Ben Test", "Move to pending");
    expect(state.updates).toEqual([]);
    expect(document.body.textContent).toContain("Move Ben Test back to pending?");

    await click("Move to pending");
    expect(state.updates).toEqual([{ table: "profiles", values: { role: "pending" } }]);
    expect(toast.success).toHaveBeenCalledWith("Role changed.");
    expect(push).not.toHaveBeenCalled();
  });

  it("asks the server what Delete account would delete before anything is deleted", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await choose("Ben Test", "Delete account");

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/admin/members/you");
    expect(push).not.toHaveBeenCalled();
  });

  it("opens Edit member from the menu", async () => {
    await mount();
    await choose("Ben Test", "Edit");
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/members/you");
  });

  it("opens Edit member from anywhere on the row, and nothing from an invite's row", async () => {
    state.requests = [INVITE];
    await mount();
    const cellOf = (email: string) => [...host.querySelectorAll("td")].find((cell) => cell.textContent === email)!;

    await act(async () => cellOf("other.ben@example.test").click());
    expect(push).not.toHaveBeenCalled();

    await act(async () => cellOf("ben@example.test").click());
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/members/you");
  });

  it("says why when the database refuses to demote the last church admin", async () => {
    state.updateResult = { data: null, error: { code: "CA001" } };
    await mount();
    await choose("Ben Test", "Move to pending");
    await click("Move to pending");
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't change this role. A church needs at least one church admin.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says so when the list can't be re-read after a saved change", async () => {
    await mount();
    state.loadError = { code: "XX000" };
    await choose("Ben Test", "Move to pending");
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

  it("shows the error state when the emails can't be read", async () => {
    state.emailsError = { code: "42501" };
    await mount();
    expect(host.textContent).toContain("Couldn't load");
    expect(host.textContent).not.toContain("Ben Test");
  });

  it("does not report a role change that matched no row", async () => {
    state.updateResult = { data: [], error: null };
    await mount();
    await choose("Ben Test", "Move to pending");
    await click("Move to pending");
    expect(toast.error).toHaveBeenCalledWith("Couldn't change this role. Try again.");
  });

  it("filters what is loaded by name or email", async () => {
    await mount();
    await search("ben@");
    expect(host.textContent).toContain("1 of 2 members");
    expect(tab(/^All/).textContent).toBe("All (1)");
    expect(host.textContent).toContain("Ben Test");
    expect(host.textContent).not.toContain("Ada Test");
  });

  it("lists and counts an invitee who shares a member's name, with no menu, and finds them by email", async () => {
    state.requests = [INVITE];
    await mount();
    expect(tab(/^All/).textContent).toBe("All (3)");
    expect(tab(/^Invited/).textContent).toBe("Invited (1)");
    expect(host.querySelectorAll('[aria-label="More actions for Ben Test"]')).toHaveLength(1);

    await search("other.ben@");
    expect(host.textContent).toContain("1 of 3 members");
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0].textContent).toContain("Invited");
  });

  it("narrows to one status, and each tab's count is the rows it shows", async () => {
    state.profiles.push(profile("cy", "Cy", "pending"));
    state.requests = [INVITE];
    await mount();
    expect(tab(/^Pending/).textContent).toBe("Pending (1)");

    await act(async () => tab(/^Pending/).click());
    expect(bodyRows().map((row) => row.querySelector("td")?.textContent)).toEqual(["Cy Test"]);
    expect(host.textContent).toContain("1 of 4 members");
    expect(await openMenu("Cy Test")).toEqual(["Edit", "Delete account"]);
  });
});
