// Unit tests for the remove route: the two branches (plain delete on the
// request client for an unattached row; service-role 'removing' transition
// with lease clear for an attached one), idempotency on an existing
// tombstone, and the zero-row-write guards on both writes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { DELETE } = await import("@/app/api/admin/domains/[id]/route");

type EqCall = [string, unknown];

function makeServiceClient(opts: {
  rowResult: { data: unknown; error: unknown };
  updateResult?: { data: unknown[] | null; error: unknown };
}) {
  const calls = {
    rowEq: [] as EqCall[],
    updatePayload: undefined as unknown,
    updateFilters: [] as Array<[string, ...unknown[]]>,
    updateCount: 0,
  };
  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq(col: string, val: unknown) {
              calls.rowEq.push([col, val]);
              return chain;
            },
            maybeSingle: async () => opts.rowResult,
          };
          return chain;
        },
        update(payload: unknown) {
          calls.updateCount += 1;
          calls.updatePayload = payload;
          const chain = {
            eq(col: string, val: unknown) {
              calls.updateFilters.push(["eq", col, val]);
              return chain;
            },
            not(col: string, op: string, val: unknown) {
              calls.updateFilters.push(["not", col, op, val]);
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

function makeRequestClient(deleteResult: { error: unknown; count: number | null }) {
  const calls = { deleteEq: [] as EqCall[], deleteCount: 0, deleteOptions: undefined as unknown };
  const client = {
    from() {
      return {
        delete(options: unknown) {
          calls.deleteCount += 1;
          calls.deleteOptions = options;
          const chain = {
            eq(col: string, val: unknown) {
              calls.deleteEq.push([col, val]);
              return chain;
            },
            then(resolve: (v: unknown) => unknown) {
              return Promise.resolve(deleteResult).then(resolve);
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function call(id = "row-1") {
  return DELETE(new Request(`http://localhost/api/admin/domains/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  requireOrgAdmin.mockReset();
  createServiceClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("DELETE /api/admin/domains/[id]", () => {
  it("deletes an unattached row on the request client, scoped on (id, org_id), and never touches the service update", async () => {
    const service = makeServiceClient({
      rowResult: { data: { id: "row-1", status: "verified", attached_at: null }, error: null },
    });
    const request = makeRequestClient({ error: null, count: 1 });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: request.client });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: "deleted" });
    expect(service.calls.rowEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    expect(request.calls.deleteCount).toBe(1);
    expect(request.calls.deleteOptions).toEqual({ count: "exact" });
    expect(request.calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    expect(service.calls.updateCount).toBe(0);
  });

  it("409s when the unattached delete affects zero rows (row changed under us)", async () => {
    const service = makeServiceClient({
      rowResult: { data: { id: "row-1", status: "verified", attached_at: null }, error: null },
    });
    const request = makeRequestClient({ error: null, count: 0 });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: request.client });

    const res = await call();

    expect(res.status).toBe(409);
  });

  it("flips an attached row to 'removing', clears the lease, keeps attached_at, and never deletes", async () => {
    const service = makeServiceClient({
      rowResult: {
        data: { id: "row-1", status: "verified", attached_at: "2026-09-01T00:00:00.000Z" },
        error: null,
      },
    });
    const request = makeRequestClient({ error: null, count: 1 });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: request.client });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: "removing" });
    expect(request.calls.deleteCount).toBe(0);
    expect(service.calls.updateCount).toBe(1);
    // The only transition that keeps attached_at: the payload must not name it.
    expect(service.calls.updatePayload).toEqual({
      status: "removing",
      attach_claimed_at: null,
      attach_claim_token: null,
    });
    expect(service.calls.updateFilters).toEqual([
      ["eq", "id", "row-1"],
      ["eq", "org_id", "org-1"],
      ["eq", "status", "verified"],
      ["not", "attached_at", "is", null],
    ]);
  });

  it("409s when the 'removing' transition affects zero rows", async () => {
    const service = makeServiceClient({
      rowResult: {
        data: { id: "row-1", status: "verified", attached_at: "2026-09-01T00:00:00.000Z" },
        error: null,
      },
      updateResult: { data: [], error: null },
    });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: makeRequestClient({ error: null, count: 1 }).client });

    const res = await call();

    expect(res.status).toBe(409);
  });

  it("is idempotent on a row already in 'removing' — no write on either client", async () => {
    const service = makeServiceClient({
      rowResult: {
        data: { id: "row-1", status: "removing", attached_at: "2026-09-01T00:00:00.000Z" },
        error: null,
      },
    });
    const request = makeRequestClient({ error: null, count: 1 });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: request.client });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: "removing" });
    expect(request.calls.deleteCount).toBe(0);
    expect(service.calls.updateCount).toBe(0);
  });

  it("404s for a row outside the caller's org", async () => {
    const service = makeServiceClient({ rowResult: { data: null, error: null } });
    createServiceClient.mockResolvedValue(service.client);
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: makeRequestClient({ error: null, count: 1 }).client });

    const res = await call("not-mine");

    expect(res.status).toBe(404);
  });

  it("401s / 403s from the gate without touching the service client", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await call();
    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
