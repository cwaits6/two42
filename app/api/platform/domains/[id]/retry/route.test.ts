// Unit tests for the platform retry route. The security-relevant properties:
// it never writes attached_at, its write is scoped on the row's own org_id
// (resolved from the row, never from the caller), and it clears only an
// EXPIRED lease — zero rows is a normal answer, not an error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACH_LEASE_WINDOW_MS } from "@/lib/domains";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { POST } = await import("@/app/api/platform/domains/[id]/retry/route");

function makeServiceClient(opts: {
  rowResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown[] | null; error: unknown };
}) {
  const calls = {
    updatePayload: undefined as unknown,
    filters: [] as Array<[string, ...unknown[]]>,
  };
  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () =>
              opts.rowResult ?? { data: { id: "row-1", org_id: "org-9" }, error: null },
          };
          return chain;
        },
        update(payload: unknown) {
          calls.updatePayload = payload;
          const chain = {
            eq(col: string, val: unknown) {
              calls.filters.push(["eq", col, val]);
              return chain;
            },
            is(col: string, val: unknown) {
              calls.filters.push(["is", col, val]);
              return chain;
            },
            lt(col: string, val: unknown) {
              calls.filters.push(["lt", col, val]);
              return chain;
            },
            select: async () => opts.updateResult ?? { data: [{ id: "row-1" }], error: null },
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function call(id = "row-1") {
  return POST(new Request(`http://localhost/api/platform/domains/${id}/retry`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  requirePlatformAdmin.mockReset();
  createServiceClient.mockReset();
  requirePlatformAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/platform/domains/[id]/retry", () => {
  it("clears only the lease columns, scoped on the row's org, for an expired claim", async () => {
    const { client, calls } = makeServiceClient({});
    createServiceClient.mockResolvedValue(client);

    const before = Date.now();
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, released: true });
    expect(calls.updatePayload).toEqual({ attach_claimed_at: null, attach_claim_token: null });
    expect(calls.updatePayload).not.toHaveProperty("attached_at");
    expect(calls.filters.slice(0, 4)).toEqual([
      ["eq", "id", "row-1"],
      ["eq", "org_id", "org-9"],
      ["eq", "status", "verified"],
      ["is", "attached_at", null],
    ]);
    const lt = calls.filters[4];
    expect(lt[0]).toBe("lt");
    expect(lt[1]).toBe("attach_claimed_at");
    const cutoffAge = before - new Date(lt[2] as string).getTime();
    expect(cutoffAge).toBeGreaterThanOrEqual(ATTACH_LEASE_WINDOW_MS - 1000);
    expect(cutoffAge).toBeLessThanOrEqual(ATTACH_LEASE_WINDOW_MS + 5000);
  });

  it("reports released:false (200) when no expired claim matched — a live lease is left alone", async () => {
    const { client } = makeServiceClient({ updateResult: { data: [], error: null } });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, released: false });
  });

  it("404s when the row does not exist", async () => {
    const { client, calls } = makeServiceClient({ rowResult: { data: null, error: null } });
    createServiceClient.mockResolvedValue(client);

    const res = await call("missing");

    expect(res.status).toBe(404);
    expect(calls.updatePayload).toBeUndefined();
  });

  it("401s / 403s from the gate without touching the service client", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await call()).status).toBe(401);
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await call()).status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("500s on an update error", async () => {
    const { client } = makeServiceClient({ updateResult: { data: null, error: { message: "boom" } } });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(500);
  });
});
