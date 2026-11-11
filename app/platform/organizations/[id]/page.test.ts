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

const { ErrorState } = await import("@/components/states/ErrorState");
const { OrganizationDetail } = await import("./OrganizationDetail");
const { default: PlatformOrganizationPage } = await import("./page");

type Element = {
  type?: unknown;
  props: { children?: unknown; emailCap?: unknown; emailDomain?: unknown; owner?: unknown; thing?: string };
};

async function renderedChildren(): Promise<Element[]> {
  const page = (await PlatformOrganizationPage({ params: Promise.resolve({ id: "o" }) })) as Element;
  return page.props.children as Element[];
}

async function renderedDetail(): Promise<Element> {
  const detail = (await renderedChildren()).find((child) => child.type === OrganizationDetail);
  if (!detail) throw new Error("The page did not render the organization's cards");
  return detail;
}

/** What the page shows in place of the organization's cards when a read fails. */
async function failedThing(): Promise<string | undefined> {
  const children = await renderedChildren();
  expect(children.map((child) => child.type)).not.toContain(OrganizationDetail);
  return children.find((child) => child.type === ErrorState)?.props.thing;
}

const FAILED: Result = { data: null, error: { code: "57014" } };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
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
    results.org_email_limits = FAILED;
    const failed = await renderedDetail();
    expect(failed.props.emailCap).toBeNull();

    results.org_email_limits = { data: { daily_cap: 200 }, error: null };
    const loaded = await renderedDetail();

    expect(loaded.props.emailCap).toEqual({ dailyCap: 200, hasOverride: true, usedToday: 3 });
  });

  it("tells a used invite link from one never sent and one still outstanding", async () => {
    const row = { id: "ar-1", name: "Ada", email: "ada@example.test", status: "approved" };
    const ownerFor = async (signup_token: string | null, token_expires_at: string | null) => {
      results.access_requests = { data: [{ ...row, signup_token, token_expires_at }], error: null };
      return (await renderedDetail()).props.owner;
    };

    expect(await ownerFor(null, null)).toMatchObject({ inviteOutstanding: false, inviteUsed: false });
    expect(await ownerFor("t", "2026-11-18T00:00:00Z")).toMatchObject({ inviteOutstanding: true, inviteUsed: false });
    expect(await ownerFor(null, "2026-11-18T00:00:00Z")).toMatchObject({ inviteOutstanding: false, inviteUsed: true });
  });

  it("shows a failed read of the organization, not the list as if it were missing", async () => {
    results.organizations = FAILED;

    expect(await failedThing()).toBe("this organization");
  });

  it("shows a failed read of the first admin, not an organization with none", async () => {
    results.access_requests = FAILED;

    expect(await failedThing()).toBe("the first admin");
  });

  it("passes no daily email limit when today's count can't be read", async () => {
    results.org_email_usage = FAILED;

    expect((await renderedDetail()).props.emailCap).toBeNull();
  });

  it("passes a failed read of the sending domain, not an organization with no domain", async () => {
    results.org_email_domains = FAILED;

    expect((await renderedDetail()).props.emailDomain).toEqual({ loaded: false });
  });
});
