// Pins that a malformed path slug never reaches getOrgBranding() — and
// through it an HTTP header on a Supabase client. Follows the direct-import-and-invoke-with-mocked-collaborators shape from
// app/api/platform/organizations/[id]/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isValidOrgSlug = vi.fn();
vi.mock("@/lib/org", () => ({ isValidOrgSlug: (slug: string) => isValidOrgSlug(slug) }));

const getOrgBranding = vi.fn();
vi.mock("@/lib/branding", () => ({ getOrgBranding: (orgSlug: string) => getOrgBranding(orgSlug) }));

const { default: OrgSlugLayout, generateMetadata } = await import("./layout");

beforeEach(() => {
  isValidOrgSlug.mockReset();
  getOrgBranding.mockReset();
});

describe("OrgSlugLayout", () => {
  it("never calls getOrgBranding when the slug shape check fails", async () => {
    isValidOrgSlug.mockReturnValue(false);

    await OrgSlugLayout({
      children: "child",
      params: Promise.resolve({ orgSlug: "../etc" }),
    });

    expect(getOrgBranding).not.toHaveBeenCalled();
  });

  it("resolves branding for the path slug when it is valid", async () => {
    isValidOrgSlug.mockReturnValue(true);
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
  });
});

describe("OrgSlugLayout generateMetadata", () => {
  it("returns no title override when the slug shape check fails", async () => {
    isValidOrgSlug.mockReturnValue(false);

    const metadata = await generateMetadata({
      params: Promise.resolve({ orgSlug: "../etc" }),
    });

    expect(metadata).toEqual({});
    expect(getOrgBranding).not.toHaveBeenCalled();
  });

  it("builds a title template from the org's display name", async () => {
    isValidOrgSlug.mockReturnValue(true);
    getOrgBranding.mockResolvedValue({
      display_name: "Acme",
      logo_url: null,
      accent: "#123abc",
      reply_to: null,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ orgSlug: "acme" }),
    });

    expect(metadata).toEqual({
      title: { template: "%s | Acme", default: "Acme" },
    });
  });
});
