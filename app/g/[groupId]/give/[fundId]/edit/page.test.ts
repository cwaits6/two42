import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const state = vi.hoisted(() => ({
  groupRole: "member" as "member" | "leader",
  profile: { role: "member", org_id: "o1" } as { role: string; org_id: string },
  fund: { id: "f1", steward_id: "someone-else" } as { id: string; steward_id: string } | null,
  fundError: null as { code: string; message: string } | null,
  manageMode: "stewards",
  methods: [] as unknown[] | null,
  directory: [] as unknown[] | null,
}));

function query(table: string) {
  const list =
    table === "giving_fund_methods" ? state.methods : table === "profiles_directory" ? state.directory : [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: state.profile, error: null }),
    maybeSingle: () =>
      Promise.resolve(
        table === "giving_funds"
          ? { data: state.fund, error: state.fundError }
          : { data: { value: state.manageMode }, error: null }
      ),
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve(
        resolve(list === null ? { data: null, error: { code: "57014", message: "boom" } } : { data: list, error: null })
      ),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => query(table) }),
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
vi.mock("@/components/giving/FundForm", () => ({
  FundForm: ({ backHref }: { backHref: string }) => `fund form, back to ${backHref}`,
}));

const { default: EditFundPage } = await import("./page");

async function render() {
  const element = (await EditFundPage({
    params: Promise.resolve({ groupId: "g1", fundId: "f1" }),
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.groupRole = "member";
  state.profile = { role: "member", org_id: "o1" };
  state.fund = { id: "f1", steward_id: "someone-else" };
  state.fundError = null;
  state.manageMode = "stewards";
  state.methods = [];
  state.directory = [];
});

describe("EditFundPage role checks", () => {
  it("sends a member back to Give when the fund goes to someone else", async () => {
    await expect(render()).rejects.toThrow("redirect:/g/g1/give");
  });

  it("sends the fund's recipient back to Give when members can't manage funds", async () => {
    state.fund = { id: "f1", steward_id: "me" };
    state.manageMode = "admins";
    await expect(render()).rejects.toThrow("redirect:/g/g1/give");
  });

  it("opens the form for the fund's recipient when members can manage funds", async () => {
    state.fund = { id: "f1", steward_id: "me" };
    expect(await render()).toContain("fund form, back to /g/g1/give");
  });

  it("opens the form for a leader, on any fund, whatever the setting", async () => {
    state.groupRole = "leader";
    state.manageMode = "admins";
    expect(await render()).toContain("fund form, back to /g/g1/settings/giving");
  });

  it("sends a pending profile to the dashboard", async () => {
    state.profile = { role: "pending", org_id: "o1" };
    await expect(render()).rejects.toThrow("redirect:/dashboard");
  });
});

describe("EditFundPage reads", () => {
  it("is not found when the fund doesn't exist", async () => {
    state.fund = null;
    await expect(render()).rejects.toThrow("notFound");
  });

  it("shows the error state with no form when the fund can't be read", async () => {
    state.fund = null;
    state.fundError = { code: "57014", message: "boom" };
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load the fund.");
    expect(html).not.toContain("fund form");
  });

  it.each(["methods", "directory"] as const)(
    "shows no form after a partial read of %s, since saving prunes what the form doesn't show",
    async (read) => {
      state.groupRole = "leader";
      state[read] = null;
      const html = await render();
      expect(html).toContain("Couldn&#x27;t load the fund.");
      expect(html).not.toContain("fund form");
    }
  );
});
