import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  groupRole: "member" as "member" | "leader",
  manageMode: "stewards",
}));

function query() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: { role: "member", org_id: "o1" }, error: null }),
    maybeSingle: () => Promise.resolve({ data: { value: state.manageMode }, error: null }),
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => query() }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: state.groupRole }),
}));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: unknown[]) => urls.map(() => null),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));
vi.mock("@/components/giving/FundForm", () => ({ FundForm: () => "fund form" }));

const { default: NewFundPage } = await import("./page");

async function render() {
  const element = (await NewFundPage({ params: Promise.resolve({ groupId: "g1" }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  state.groupRole = "member";
  state.manageMode = "stewards";
});

describe("NewFundPage role checks", () => {
  it("sends a member back to Give when members can't add funds", async () => {
    state.manageMode = "admins";
    await expect(render()).rejects.toThrow("redirect:/g/g1/give");
  });

  it("opens the form for a member when members can add funds", async () => {
    expect(await render()).toContain("fund form");
  });

  it("opens the form for a leader, whatever the setting", async () => {
    state.groupRole = "leader";
    state.manageMode = "admins";
    expect(await render()).toContain("fund form");
  });
});
