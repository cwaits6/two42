// Pins that generateMetadata() never queries page_content for a malformed
// path slug, and queries it as the path slug's org otherwise. Follows the direct-import-and-invoke-with-mocked-collaborators shape from
// app/api/platform/organizations/[id]/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isValidOrgSlug = vi.fn();
vi.mock("@/lib/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org")>()),
  isValidOrgSlug: (slug: string) => isValidOrgSlug(slug),
}));

const single = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: (orgSlug: string) => createClient(orgSlug),
}));

const { generateMetadata } = await import("./page");

beforeEach(() => {
  isValidOrgSlug.mockReset();
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
    expect(createClient).not.toHaveBeenCalled();
  });

  it("queries page_content through a client scoped to the path slug", async () => {
    isValidOrgSlug.mockReturnValue(true);
    single.mockResolvedValue({ data: { title: "About Us" } });

    const metadata = await generateMetadata({
      params: Promise.resolve({ orgSlug: "acme", slug: "about" }),
    });

    expect(metadata.title).toContain("About Us");
    expect(createClient).toHaveBeenCalledWith("acme");
  });
});
