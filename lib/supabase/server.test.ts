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
    config: { global?: { headers?: Record<string, string> } }
  ) => unknown
>(() => ({}));

vi.mock("@supabase/ssr", () => ({
  // Deferred call (not a direct reference) so the hoisted factory never
  // touches the const above before it initializes — mirrors
  // lib/supabase/middleware.test.ts's mock shape.
  createServerClient: (
    url: string,
    key: string,
    config: { global?: { headers?: Record<string, string> } }
  ) => createServerClient(url, key, config),
}));

// vi.mock is hoisted, so this import sees the mocks above.
const { createClient } = await import("@/lib/supabase/server");

describe("createClient — org resolution", () => {
  beforeEach(() => {
    headersMock.mockReset();
    createServerClient.mockClear();
  });

  it("sends no x-two42-org header and ignores one on the request", async () => {
    headersMock.mockReturnValue({
      get: (name: string) => (name === "x-two42-org" ? "grace" : null),
    });
    await createClient();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global?.headers?.["x-two42-org"]).toBeUndefined();
  });
});
