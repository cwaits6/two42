import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { getPlatformAdmin, requirePlatformAdmin } = await import("@/lib/platform-access");

const USER = { id: "user-1" };

beforeEach(() => {
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: USER } });
  rpc.mockReset();
});

describe("requirePlatformAdmin", () => {
  it("answers 401 for a visitor who is not signed in, without asking the gate", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    expect(await requirePlatformAdmin()).toEqual({ ok: false, status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets an operator through", async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    expect(await requirePlatformAdmin()).toEqual({ ok: true, user: USER });
  });

  it("answers a plain 403 for a person who is not an operator", async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    expect(await requirePlatformAdmin()).toEqual({ ok: false, status: 403 });
  });

  it("denies when the check fails, and says the answer is unknown", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await requirePlatformAdmin()).toEqual({ ok: false, status: 403, unavailable: true });
    expect(await getPlatformAdmin()).toBeNull();
  });
});
