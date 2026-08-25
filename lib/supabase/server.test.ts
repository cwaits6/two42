import { beforeEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.fn();
const cookiesMock = vi.fn(() => ({
  getAll: () => [],
  get: () => undefined,
  set: () => undefined,
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
  cookies: () => cookiesMock(),
}));

// notFound() throws in the real Next.js runtime — mirror that so tests can
// distinguish "threw" from "returned" rather than needing App Router
// internals.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const createServerClient = vi.fn<
  (
    url: string,
    key: string,
    config: { global: { headers: Record<string, string> } }
  ) => unknown
>(() => ({}));

vi.mock("@supabase/ssr", () => ({
  // Deferred call (not a direct reference) so the hoisted factory never
  // touches the const above before it initializes — mirrors
  // lib/supabase/middleware.test.ts's mock shape.
  createServerClient: (
    url: string,
    key: string,
    config: { global: { headers: Record<string, string> } }
  ) => createServerClient(url, key, config),
}));

// vi.mock is hoisted, so this import sees the mocks above.
const { assertPathOrgMatchesHost, createClient } = await import(
  "@/lib/supabase/server"
);

function headersWith(resolvedOrg: string | null) {
  return {
    get: (name: string) => (name === "x-two42-resolved-org" ? resolvedOrg : null),
  };
}

describe("assertPathOrgMatchesHost", () => {
  beforeEach(() => {
    headersMock.mockReset();
  });

  it("404s when the host resolved a different org than the path slug", async () => {
    headersMock.mockReturnValue(headersWith("grace"));
    await expect(assertPathOrgMatchesHost("hope")).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
  });

  it("passes through when the host resolved the same org as the path slug", async () => {
    headersMock.mockReturnValue(headersWith("grace"));
    await expect(assertPathOrgMatchesHost("grace")).resolves.toBeUndefined();
  });

  it("is a no-op when the host resolved no org (platform host / trusted fallback)", async () => {
    headersMock.mockReturnValue(headersWith(null));
    await expect(assertPathOrgMatchesHost("grace")).resolves.toBeUndefined();
  });
});

describe("createClient — x-two42-org precedence", () => {
  beforeEach(() => {
    headersMock.mockReset();
    createServerClient.mockClear();
    delete process.env.NEXT_PUBLIC_ORG_SLUG;
  });

  it("uses the explicit orgSlug argument over the resolved header", async () => {
    headersMock.mockReturnValue(headersWith("grace"));
    await createClient("hope");
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("hope");
  });

  it("uses the resolved header when no explicit orgSlug is passed", async () => {
    headersMock.mockReturnValue(headersWith("grace"));
    await createClient();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("grace");
  });

  it("falls back to the env pin when neither an argument nor a resolved header exists", async () => {
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
    headersMock.mockReturnValue(headersWith(null));
    await createClient();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });
});
