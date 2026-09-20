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
const { createClient } = await import("@/lib/supabase/server");

describe("createClient — x-two42-org precedence", () => {
  beforeEach(() => {
    headersMock.mockReset();
    createServerClient.mockClear();
    delete process.env.NEXT_PUBLIC_ORG_SLUG;
  });

  it("uses the explicit orgSlug argument over the env pin", async () => {
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
    await createClient("hope");
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("hope");
  });

  it("falls back to the env pin when no orgSlug is passed", async () => {
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
    await createClient();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });

  it("never takes the org from a request header", async () => {
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
    headersMock.mockReturnValue({
      get: (name: string) => (name === "x-two42-org" ? "grace" : null),
    });
    await createClient();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });
});
