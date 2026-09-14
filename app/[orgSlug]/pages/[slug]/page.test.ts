// Pins the ordering this file exists to protect: assertPathOrgMatchesHost()
// must run before generateMetadata() ever queries page_content, the same
// property app/[orgSlug]/layout.test.ts pins for the org-scoped layout.
// Follows the direct-import-and-invoke-with-mocked-collaborators shape from
// app/api/platform/organizations/[id]/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isValidOrgSlug = vi.fn();
vi.mock("@/lib/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org")>()),
  isValidOrgSlug: (slug: string) => isValidOrgSlug(slug),
}));

const assertPathOrgMatchesHost = vi.fn();
const single = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  assertPathOrgMatchesHost: (orgSlug: string) => assertPathOrgMatchesHost(orgSlug),
  createClient: (orgSlug: string) => createClient(orgSlug),
}));

const { generateMetadata } = await import("./page");

beforeEach(() => {
  isValidOrgSlug.mockReset();
  assertPathOrgMatchesHost.mockReset();
  createClient.mockReset();
  single.mockReset();
  createClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({ single }),
      }),
    }),
  });
});

describe("generateMetadata", () => {
  it("never queries page_content when the slug shape check fails", async () => {
    single.mockResolvedValue({ data: null });

    const metadata = await generateMetadata({
      params: Promise.resolve({ orgSlug: "../etc", slug: "about" }),
    });

    expect(metadata).toEqual({ title: "Page Not Found" });
    expect(assertPathOrgMatchesHost).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("propagates the host guard's 404 instead of returning page metadata", async () => {
    isValidOrgSlug.mockReturnValue(true);
    assertPathOrgMatchesHost.mockRejectedValue(new Error("NEXT_NOT_FOUND"));

    await expect(
      generateMetadata({ params: Promise.resolve({ orgSlug: "other-org", slug: "about" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(createClient).not.toHaveBeenCalled();
  });

  it("calls assertPathOrgMatchesHost before querying page_content", async () => {
    isValidOrgSlug.mockReturnValue(true);
    assertPathOrgMatchesHost.mockResolvedValue(undefined);
    single.mockResolvedValue({ data: { title: "About Us" } });

    const metadata = await generateMetadata({
      params: Promise.resolve({ orgSlug: "acme", slug: "about" }),
    });

    expect(metadata.title).toContain("About Us");
    const hostCallOrder = assertPathOrgMatchesHost.mock.invocationCallOrder[0];
    const clientCallOrder = createClient.mock.invocationCallOrder[0];
    expect(hostCallOrder).toBeLessThan(clientCallOrder);
  });
});
