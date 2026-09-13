// Pins the ordering this PR exists to protect: assertPathOrgMatchesHost()
// must run — and be allowed to 404 — before getOrgBranding() ever reaches a
// Supabase client. Neither schema_tenancy_lint.sql nor guard:tenancy can see
// this; it's an in-process call-order question in a React server component.
// Follows the direct-import-and-invoke-with-mocked-collaborators shape from
// app/api/platform/organizations/[id]/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isValidOrgSlug = vi.fn();
vi.mock("@/lib/org", () => ({ isValidOrgSlug: (slug: string) => isValidOrgSlug(slug) }));

const assertPathOrgMatchesHost = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  assertPathOrgMatchesHost: (orgSlug: string) => assertPathOrgMatchesHost(orgSlug),
}));

const getOrgBranding = vi.fn();
vi.mock("@/lib/branding", () => ({ getOrgBranding: (orgSlug: string) => getOrgBranding(orgSlug) }));

const { default: OrgSlugLayout } = await import("./layout");

beforeEach(() => {
  isValidOrgSlug.mockReset();
  assertPathOrgMatchesHost.mockReset();
  getOrgBranding.mockReset();
});

describe("OrgSlugLayout", () => {
  it("never calls getOrgBranding when the slug shape check fails", async () => {
    isValidOrgSlug.mockReturnValue(false);

    await OrgSlugLayout({
      children: "child",
      params: Promise.resolve({ orgSlug: "../etc" }),
    });

    expect(assertPathOrgMatchesHost).not.toHaveBeenCalled();
    expect(getOrgBranding).not.toHaveBeenCalled();
  });

  it("never calls getOrgBranding when the host guard rejects the slug", async () => {
    isValidOrgSlug.mockReturnValue(true);
    // assertPathOrgMatchesHost() 404s via next/navigation's notFound(),
    // which throws — the layout must not swallow that and fall through.
    assertPathOrgMatchesHost.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(
      OrgSlugLayout({
        children: "child",
        params: Promise.resolve({ orgSlug: "other-org" }),
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(getOrgBranding).not.toHaveBeenCalled();
  });

  it("calls assertPathOrgMatchesHost before getOrgBranding when the slug is valid", async () => {
    isValidOrgSlug.mockReturnValue(true);
    assertPathOrgMatchesHost.mockResolvedValue(undefined);
    getOrgBranding.mockResolvedValue({
      display_name: "Acme",
      logo_url: null,
      accent: "#123abc",
      reply_to: null,
    });

    await OrgSlugLayout({
      children: "child",
      params: Promise.resolve({ orgSlug: "acme" }),
    });

    expect(getOrgBranding).toHaveBeenCalledWith("acme");
    const hostCallOrder = assertPathOrgMatchesHost.mock.invocationCallOrder[0];
    const brandingCallOrder = getOrgBranding.mock.invocationCallOrder[0];
    expect(hostCallOrder).toBeLessThan(brandingCallOrder);
  });
});
