// Pins which org slug the root layout hands to client components: a signed-in
// member's own org, never the env pin, because the sidebar builds
// /<slug>/pages/** links from it.

import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./globals.css", () => ({}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font" });
  return { Cormorant_Garamond: font, Inter_Tight: font, JetBrains_Mono: font };
});
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/components/layout/SidebarContext", () => ({ SidebarProvider: () => null }));
vi.mock("@/lib/org", () => ({ resolveOrgSlug: () => "pinned" }));
vi.mock("@/lib/branding", () => ({
  getRequestBranding: async () => ({ display_name: "two42", accent: "#123abc" }),
}));

const cookieNames = vi.fn<() => string[]>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => cookieNames().map((name) => ({ name })) }),
  headers: async () => new Headers(),
}));

const organizationsQuery = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const { OrgSlugProvider } = await import("@/components/providers/OrgSlugProvider");
const { default: RootLayout } = await import("./layout");

function memberClient(profile: { id: string; org_id: string; role: string }) {
  const tables: Record<string, unknown> = {
    profiles: { select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) },
    profile_groups: { select: () => ({ eq: async () => ({ data: [], error: null }) }) },
    organizations: {
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => organizationsQuery(columns, column, value),
        }),
      }),
    },
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } } }) },
    from: (table: string) => tables[table],
    rpc: async () => ({ data: false }),
  };
}

function providedOrgSlug(node: ReactNode): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = providedOrgSlug(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ orgSlug?: string; children?: ReactNode }>(node)) return undefined;
  if (node.type === OrgSlugProvider) return node.props.orgSlug;
  return providedOrgSlug(node.props.children);
}

beforeEach(() => {
  cookieNames.mockReset();
  organizationsQuery.mockReset();
  createClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("RootLayout org slug", () => {
  const member = { id: "user-1", org_id: "org-acme", role: "member" };

  it("provides the signed-in member's own org slug, not the env pin", async () => {
    cookieNames.mockReturnValue(["sb-auth-token"]);
    createClient.mockResolvedValue(memberClient(member));
    organizationsQuery.mockResolvedValue({ data: { slug: "acme" }, error: null });

    const tree = await RootLayout({ children: "child" });

    expect(organizationsQuery).toHaveBeenCalledWith("slug", "id", "org-acme");
    expect(providedOrgSlug(tree)).toBe("acme");
  });

  it("keeps the env pin when the org lookup fails", async () => {
    cookieNames.mockReturnValue(["sb-auth-token"]);
    createClient.mockResolvedValue(memberClient(member));
    organizationsQuery.mockResolvedValue({ data: null, error: { message: "boom" } });

    const tree = await RootLayout({ children: "child" });

    expect(providedOrgSlug(tree)).toBe("pinned");
  });

  it("provides the env pin to anonymous requests without building a client", async () => {
    cookieNames.mockReturnValue([]);

    const tree = await RootLayout({ children: "child" });

    expect(createClient).not.toHaveBeenCalled();
    expect(providedOrgSlug(tree)).toBe("pinned");
  });
});
