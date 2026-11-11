// What the setup form learns about a link before the person types a
// password: name and email for a live link, "already set up" for a link that
// created an account, and one invalid answer for everything else.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupUserId } from "../setup-link";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const logError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...args: unknown[]) => logError(...args) }));

const { POST } = await import("./route");

const TOKEN = "b".repeat(64);
const LIVE = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  status: "approved",
  token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  org_id: "11111111-1111-4111-8111-111111111111",
};
const EXPIRED = { ...LIVE, token_expires_at: new Date(Date.now() - 1000).toISOString() };

function fakeService(opts: {
  row?: unknown;
  lookupError?: unknown;
  account?: boolean;
  accountError?: { status: number; message: string };
}) {
  const getUserById = vi.fn(async (id: string) => {
    if (opts.accountError) return { data: { user: null }, error: opts.accountError };
    return opts.account && id === setupUserId(TOKEN)
      ? { data: { user: { id, email: LIVE.email } }, error: null }
      : { data: { user: null }, error: { status: 404, code: "user_not_found", message: "nope" } };
  });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: opts.row ?? null, error: opts.lookupError ?? null }),
  };
  createServiceClient.mockResolvedValue({ from: () => chain, auth: { admin: { getUserById } } });
  return { getUserById };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/verify-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const INVALID = { error: "Invalid or expired token" };

beforeEach(() => {
  createServiceClient.mockReset();
  logError.mockReset();
});

describe("POST /api/auth/verify-token", () => {
  it("returns the name and email for a live link, and nothing more", async () => {
    fakeService({ row: LIVE });
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: LIVE.name, email: LIVE.email });
  });

  it("answers an unknown link as invalid", async () => {
    fakeService({});
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(INVALID);
  });

  it("answers a used link as already set up", async () => {
    fakeService({ account: true });
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: "set_up" });
  });

  it("answers an expired link as expired", async () => {
    fakeService({ row: EXPIRED });
    expect((await post({ token: TOKEN })).status).toBe(410);
  });

  it("answers an expired link that set up an account as already set up", async () => {
    fakeService({ row: EXPIRED, account: true });
    expect((await post({ token: TOKEN })).status).toBe(409);
  });

  it("fails closed on a lookup error with the same answer as an unknown link", async () => {
    const { getUserById } = fakeService({ lookupError: { code: "XX000", message: "boom" } });
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(INVALID);
    expect(logError).toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("answers invalid, and logs, when the account lookup fails", async () => {
    fakeService({ accountError: { status: 500, message: "down" } });
    const res = await post({ token: TOKEN });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(INVALID);
    expect(logError).toHaveBeenCalled();
  });

  it("answers a malformed token as invalid without a lookup", async () => {
    fakeService({});
    const res = await post({ token: 12 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(INVALID);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
