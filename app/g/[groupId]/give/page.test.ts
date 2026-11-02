import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  manageMode: "stewards",
  role: "member",
  funds: [] as unknown[],
  settingFilters: [] as [string, unknown][],
}));

function query(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      if (table === "site_settings") state.settingFilters.push([column, value]);
      return chain;
    },
    or: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: { role: "member", org_id: "o1" }, error: null }),
    maybeSingle: () => Promise.resolve({ data: { value: state.manageMode }, error: null }),
    in: () => chain,
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve(resolve({ data: table === "giving_funds" ? state.funds : [], error: null })),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
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
  state.settingFilters = [];
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
    retire_on: null,
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

  it("shows a member no hidden funds", async () => {
    state.funds = [RETIRED];
    const html = await render();
    expect(html).not.toContain("Hidden from members");
    expect(html).not.toContain('href="/g/g1/give/f1/edit"');
  });
});
