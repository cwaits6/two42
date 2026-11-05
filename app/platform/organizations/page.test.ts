import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`redirect:${target}`);
  },
}));
vi.mock("@/lib/platform-access", () => ({
  getPlatformAdmin: async () => ({ id: "user-1" }),
}));
vi.mock("./OrganizationsList", () => ({ OrganizationsList: () => null }));

let result: { data: unknown; error: { code: string } | null };

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        order: () => chain,
        then: (resolve: (value: typeof result) => void) => resolve(result),
      };
      return chain;
    },
  }),
}));

const { ErrorState } = await import("@/components/states/ErrorState");
const { OrganizationsList } = await import("./OrganizationsList");
const { default: PlatformOrganizationsPage } = await import("./page");

type Element = { type?: unknown; props: { children?: unknown; initialOrgs?: unknown } };

async function renderedChildren(): Promise<Element[]> {
  const page = (await PlatformOrganizationsPage()) as Element;
  return page.props.children as Element[];
}

describe("PlatformOrganizationsPage", () => {
  it("shows the failed read, not an empty list, when organizations can't be read", async () => {
    result = { data: null, error: { code: "57014" } };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const types = (await renderedChildren()).map((child) => child.type);

    expect(types).toContain(ErrorState);
    expect(types).not.toContain(OrganizationsList);
  });

  it("lists the organizations as read", async () => {
    const orgs = [{ id: "o", name: "Sample Organization", status: "active", created_at: "2026-01-15T00:00:00Z" }];
    result = { data: orgs, error: null };

    const list = (await renderedChildren()).find((child) => child.type === OrganizationsList);

    expect(list?.props.initialOrgs).toEqual(orgs);
  });
});
