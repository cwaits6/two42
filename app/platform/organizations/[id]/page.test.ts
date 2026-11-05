import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));
vi.mock("@/lib/platform-access", () => ({
  getPlatformAdmin: async () => ({ id: "user-1" }),
}));
vi.mock("./OrganizationDetail", () => ({ OrganizationDetail: () => null }));

type Result = { data: unknown; error: { code: string } | null };
let results: Record<string, Result>;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => results[table],
        maybeSingle: async () => results[table],
      };
      return chain;
    },
  }),
}));

const { OrganizationDetail } = await import("./OrganizationDetail");
const { default: PlatformOrganizationPage } = await import("./page");

type Element = { type?: unknown; props: { children?: unknown; emailCap?: unknown } };

async function renderedDetail(): Promise<Element> {
  const page = (await PlatformOrganizationPage({ params: Promise.resolve({ id: "o" }) })) as Element;
  const detail = (page.props.children as Element[]).find((child) => child.type === OrganizationDetail);
  if (!detail) throw new Error("The page did not render the organization's cards");
  return detail;
}

beforeEach(() => {
  results = {
    organizations: {
      data: {
        id: "o",
        name: "Sample Organization",
        status: "active",
        created_at: "2026-01-15T00:00:00Z",
        branding: {},
        custom_email_domain_enabled: false,
      },
      error: null,
    },
    access_requests: { data: [], error: null },
    org_email_limits: { data: { daily_cap: 200 }, error: null },
    org_email_usage: { data: { sent_count: 3 }, error: null },
    org_email_domains: { data: null, error: null },
  };
});

describe("PlatformOrganizationPage", () => {
  it("passes no daily email limit when its read fails, and the limit as read when it loads", async () => {
    results.org_email_limits = { data: null, error: { code: "57014" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await renderedDetail();
    expect(failed.props.emailCap).toBeNull();

    results.org_email_limits = { data: { daily_cap: 200 }, error: null };
    const loaded = await renderedDetail();

    expect(loaded.props.emailCap).toEqual({ dailyCap: 200, hasOverride: true, usedToday: 3 });
  });
});
