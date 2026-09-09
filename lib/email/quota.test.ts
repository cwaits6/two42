// Unit tests for the fail-closed quota reserve contract (Phase 5 PR 8,
// CWA-72). Stubbed Supabase client — no network, no database. The edge
// mirror (supabase/functions/_shared/quota.ts) carries the same cases in
// supabase/functions/tests/quota_test.ts; a contract change lands on both.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { reserveEmailQuota } = await import("@/lib/email/quota");

const ORG_ID = "11111111-2222-3333-4444-555555555555";

function serviceWithRpc(rpc: ReturnType<typeof vi.fn>) {
  createServiceClient.mockResolvedValue({ rpc });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  createServiceClient.mockReset();
});

describe("reserveEmailQuota", () => {
  it("short-circuits to true for n = 0 without touching the RPC", async () => {
    await expect(reserveEmailQuota(ORG_ID, 0)).resolves.toBe(true);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("refuses (false) for negative n without touching the RPC", async () => {
    await expect(reserveEmailQuota(ORG_ID, -3)).resolves.toBe(false);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("returns true when the RPC grants the reservation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    serviceWithRpc(rpc);
    await expect(reserveEmailQuota(ORG_ID, 12)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("email_quota_consume", {
      _org_id: ORG_ID,
      _n: 12,
    });
  });

  it("returns false when the RPC refuses (cap hit)", async () => {
    serviceWithRpc(vi.fn().mockResolvedValue({ data: false, error: null }));
    await expect(reserveEmailQuota(ORG_ID, 12)).resolves.toBe(false);
  });

  it("treats an RPC error as a refusal (fail closed), and logs it", async () => {
    serviceWithRpc(
      vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    );
    await expect(reserveEmailQuota(ORG_ID, 5)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("treats a thrown RPC as a refusal (fail closed), never rethrows", async () => {
    serviceWithRpc(vi.fn().mockRejectedValue(new Error("network down")));
    await expect(reserveEmailQuota(ORG_ID, 5)).resolves.toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("treats a null data with no error as a refusal, not a grant", async () => {
    serviceWithRpc(vi.fn().mockResolvedValue({ data: null, error: null }));
    await expect(reserveEmailQuota(ORG_ID, 5)).resolves.toBe(false);
  });
});
