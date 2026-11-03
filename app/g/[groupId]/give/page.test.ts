import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  manageMode: "stewards",
  role: "member",
  funds: [] as unknown[],
  failedRead: null as "hidden funds" | "hidden fund methods" | null,
  settingFilters: [] as [string, unknown][],
}));

function query(table: string) {
  // Only the member-visible reads narrow with or() and in().
  let memberRead = false;
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      if (table === "site_settings") state.settingFilters.push([column, value]);
      return chain;
    },
    or: () => {
      memberRead = true;
      return chain;
    },
    order: () => chain,
    single: () => Promise.resolve({ data: { role: "member", org_id: "o1" }, error: null }),
    maybeSingle: () => Promise.resolve({ data: { value: state.manageMode }, error: null }),
    in: () => {
      memberRead = true;
      return chain;
    },
    then: (resolve: (r: unknown) => unknown) => {
      const failed =
        !memberRead &&
        ((table === "giving_funds" && state.failedRead === "hidden funds") ||
          (table === "giving_fund_methods" && state.failedRead === "hidden fund methods"));
      if (failed) return Promise.resolve(resolve({ data: null, error: { code: "57014", message: "x" } }));
      return Promise.resolve(resolve({ data: table === "giving_funds" ? state.funds : [], error: null }));
    },
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: state.role }),
}));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: unknown[]) => urls.map(() => null),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));

const { default: GivePage } = await import("./page");

async function render() {
  const element = (await GivePage({ params: Promise.resolve({ groupId: "g1" }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.manageMode = "stewards";
  state.role = "member";
  state.funds = [];
  state.failedRead = null;
  state.settingFilters = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GivePage", () => {
  it("offers Add fund to a member when members can add funds, reading the setting for their org", async () => {
    expect(await render()).toContain("Add fund");
    expect(state.settingFilters).toContainEqual(["org_id", "o1"]);
  });

  it("hides Add fund from a member when only leaders can add funds", async () => {
    state.manageMode = "admins";
    expect(await render()).not.toContain("Add fund");
  });

  const RETIRED = {
    id: "f1",
    name: "Old roof",
    is_active: false,
    needs_review: false,
    retire_on: null,
    steward_id: "s1",
    steward: null,
    steward_role: null,
  };

  it("lets a leader reach a retired fund to edit it", async () => {
    state.role = "leader";
    state.funds = [RETIRED];
    const html = await render();
    expect(html).toContain("Hidden from members");
    expect(html).toContain("Old roof");
    expect(html).toContain('href="/g/g1/give/f1/edit"');
    expect(html).not.toContain("No funds yet.");
  });

  const LIVE = {
    id: "f2",
    name: "New roof",
    is_active: true,
    needs_review: false,
    retire_on: null,
    steward_id: "s1",
    steward: { id: "s1", first_name: "Ann", last_name: "Lee", preferred_name: null, avatar_url: null },
    co_steward: null,
    steward_role: null,
  };

  it.each(["hidden funds", "hidden fund methods"] as const)(
    "keeps the funds members see when a leader's read of %s fails",
    async (failedRead) => {
      state.role = "leader";
      state.funds = [LIVE];
      state.failedRead = failedRead;
      const html = await render();
      expect(html).toContain("New roof");
      expect(html).toContain("Add fund");
      expect(html).toContain("load hidden funds.");
      expect(html).not.toContain("No funds yet.");
    }
  );

  it("does not call the page empty when a leader's read of hidden funds fails", async () => {
    state.role = "leader";
    state.failedRead = "hidden funds";
    const html = await render();
    expect(html).toContain("load hidden funds.");
    expect(html).not.toContain("No funds yet.");
  });

  const IN_REVIEW = { ...LIVE, id: "f3", name: "In review", needs_review: true };
  const NO_RECIPIENT = {
    ...LIVE,
    id: "f4",
    name: "No recipient",
    needs_review: true,
    steward_id: null,
    steward: null,
  };

  it("keeps a paused fund off Give, and gives a leader a way to review it", async () => {
    state.role = "leader";
    state.funds = [IN_REVIEW, NO_RECIPIENT];
    const html = await render();
    expect(html).not.toContain("Goes to Ann Lee</span>");
    expect(html).toContain("Hidden from members");
    expect(html).toContain("Needs review");
    expect(html).toContain("Needs a recipient");
    expect(html).toContain('href="/g/g1/give/f3/edit"');
    expect(html).toContain('href="/g/g1/give/f4/edit"');
  });

  it("gives a promoted recipient a way to their fund in review, and no other hidden fund", async () => {
    state.funds = [{ ...IN_REVIEW, steward_id: "me" }, RETIRED, IN_REVIEW];
    const html = await render();
    expect(html).toContain("Needs review");
    expect(html).toContain('href="/g/g1/give/f3/edit"');
    expect(html).not.toContain("Old roof");
  });

  it("gives that recipient no way in when only leaders can manage funds", async () => {
    state.manageMode = "admins";
    state.funds = [{ ...IN_REVIEW, steward_id: "me" }];
    expect(await render()).not.toContain("In review");
  });

  it("shows a member no hidden funds", async () => {
    state.funds = [RETIRED];
    const html = await render();
    expect(html).not.toContain("Hidden from members");
    expect(html).not.toContain('href="/g/g1/give/f1/edit"');
  });
});
