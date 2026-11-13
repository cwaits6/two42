import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "Zk3-secret-invite-token";
const GROUP = "c0000000-0000-4000-8000-00000000000b";
const EVENT = "e0000000-0000-4000-8000-0000000000aa";

const abortSignal = vi.fn();
const rpc = vi.fn();
const getSession = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession }, rpc }),
}));

const { recordUsage } = await import("./recordUsage");

beforeEach(() => {
  abortSignal.mockReset().mockResolvedValue({ data: true, error: null });
  rpc.mockReset().mockReturnValue({ abortSignal });
  getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "t" } } });
});

describe("recordUsage", () => {
  it("sends an invite page as its pattern, never the token", async () => {
    await recordUsage("view", `/join/${SECRET}`);
    expect(rpc.mock.calls).toEqual([["usage_count_record", { _pattern: "/join/[token]", _kind: "view" }]]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(SECRET);
  });

  it("sends a group page as its pattern, never the ids", async () => {
    await recordUsage("error", `/g/${GROUP}/calendar/${EVENT}`);
    expect(rpc.mock.calls).toEqual([
      ["usage_count_record", { _pattern: "/g/[groupId]/calendar/[id]", _kind: "error" }],
    ]);
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(new RegExp(`${GROUP}|${EVENT}`));
  });

  it("gives up on a write that takes too long", async () => {
    await recordUsage("view", "/dashboard");
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("sends nothing for an address that is no page", async () => {
    await recordUsage("view", "/wp-login.php");
    expect(getSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends nothing without a session", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await recordUsage("view", "/dashboard");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stays quiet when the database has no such function", async () => {
    abortSignal.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    await expect(recordUsage("view", "/dashboard")).resolves.toBeUndefined();
  });

  it("stays quiet when the request fails or the session read throws", async () => {
    abortSignal.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(recordUsage("view", "/dashboard")).resolves.toBeUndefined();
    getSession.mockRejectedValue(new Error("storage unavailable"));
    await expect(recordUsage("view", "/dashboard")).resolves.toBeUndefined();
  });
});
