import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/lib/groups/server", () => ({
  requireGroupLeader: async (id: string) => ({ id, name: "Grace", role: "leader" }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: "o1" }, error: null }) }) }),
    }),
  }),
}));
vi.mock("@/lib/groups/settings", () => ({ getGroupSettings: async () => ({}) }));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));
vi.mock("./ServingLinkModeForm", () => ({ ServingLinkModeForm: () => null }));
vi.mock("./ServingStats", () => ({ ServingStats: () => null }));

const { default: GroupServingSettingsPage } = await import("./page");

describe("GroupServingSettingsPage", () => {
  it("links to Teams once", async () => {
    const html = renderToStaticMarkup(
      await GroupServingSettingsPage({ params: Promise.resolve({ groupId: "g1" }) }),
    );
    expect(html.split('href="/g/g1/settings/teams"').length - 1).toBe(1);
  });
});
