// Unit tests for the verify route. Mocks the gate, the service client, and
// node:dns/promises so the DNS branches (match, mismatch, no record,
// timeout) and the two things that must never be confused — a DNS failure
// and the reclaim-blocked 23505 — are pinned without a resolver.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const resolveTxt = vi.fn();
vi.mock("node:dns/promises", () => ({
  resolveTxt: (...args: unknown[]) => resolveTxt(...args),
}));

const { POST } = await import("@/app/api/admin/domains/[id]/verify/route");

type EqCall = [string, unknown];

interface ServiceOptions {
  countResult?: { count: number | null; error: unknown };
  rowResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
}

function makeServiceClient(opts: ServiceOptions) {
  const calls = {
    countEq: [] as EqCall[],
    rowEq: [] as EqCall[],
    updates: [] as Array<{ payload: unknown; eq: EqCall[] }>,
  };
  const client = {
    from() {
      return {
        select(_cols: string, options?: { count?: string; head?: boolean }) {
          if (options?.head) {
            const chain = {
              eq(col: string, val: unknown) {
                calls.countEq.push([col, val]);
                return chain;
              },
              gte() {
                return chain;
              },
              then(resolve: (v: unknown) => unknown) {
                return Promise.resolve(opts.countResult ?? { count: 0, error: null }).then(resolve);
              },
            };
            return chain;
          }
          const chain = {
            eq(col: string, val: unknown) {
              calls.rowEq.push([col, val]);
              return chain;
            },
            maybeSingle: async () => opts.rowResult ?? { data: null, error: null },
          };
          return chain;
        },
        update(payload: unknown) {
          const entry = { payload, eq: [] as EqCall[] };
          calls.updates.push(entry);
          const chain = {
            eq(col: string, val: unknown) {
              entry.eq.push([col, val]);
              return chain;
            },
            select() {
              return chain;
            },
            single: async () => opts.updateResult ?? { data: { id: "row-1" }, error: null },
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

const PENDING_ROW = {
  id: "row-1",
  domain: "example.church",
  status: "pending",
  verification_token: "abc123token",
  last_checked_at: null,
};

function call(id = "row-1") {
  return POST(new Request(`http://localhost/api/admin/domains/${id}/verify`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  requireOrgAdmin.mockReset();
  createServiceClient.mockReset();
  resolveTxt.mockReset();
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/domains/[id]/verify", () => {
  it("flips the row to verified when the TXT record matches (chunks joined)", async () => {
    const { client, calls } = makeServiceClient({
      rowResult: { data: PENDING_ROW, error: null },
      updateResult: { data: { ...PENDING_ROW, status: "verified" }, error: null },
    });
    createServiceClient.mockResolvedValue(client);
    // Two records; the matching one arrives split into chunks.
    resolveTxt.mockResolvedValue([["v=spf1 ", "-all"], ["abc123", "token"]]);

    const res = await call();

    expect(res.status).toBe(200);
    expect(resolveTxt).toHaveBeenCalledWith("_two42-verify.example.church");
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].payload).toMatchObject({ status: "verified" });
    expect(calls.updates[0].payload).toHaveProperty("verified_at");
    expect(calls.updates[0].payload).toHaveProperty("last_checked_at");
    expect(calls.updates[0].eq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    // The fetch was org-scoped before any write.
    expect(calls.rowEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("stamps last_checked_at only (status untouched) and returns a diagnostic on a mismatch", async () => {
    const { client, calls } = makeServiceClient({
      rowResult: { data: PENDING_ROW, error: null },
      updateResult: { data: PENDING_ROW, error: null },
    });
    createServiceClient.mockResolvedValue(client);
    resolveTxt.mockResolvedValue([["wrong-token"]]);

    const res = await call();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(false);
    expect(body.diagnostic).toMatch(/does not match/);
    expect(calls.updates).toHaveLength(1);
    expect(Object.keys(calls.updates[0].payload as object)).toEqual(["last_checked_at"]);
    expect(calls.updates[0].eq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("treats ENOTFOUND / ENODATA as 'no record', not a 500", async () => {
    for (const code of ["ENOTFOUND", "ENODATA"]) {
      const { client } = makeServiceClient({
        rowResult: { data: PENDING_ROW, error: null },
        updateResult: { data: PENDING_ROW, error: null },
      });
      createServiceClient.mockResolvedValue(client);
      resolveTxt.mockRejectedValue(Object.assign(new Error(code), { code }));

      const res = await call();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.verified).toBe(false);
      expect(body.diagnostic).toMatch(/No TXT record found/);
    }
  });

  it("reports a DNS timeout as a diagnostic rather than hanging or 500ing", async () => {
    vi.useFakeTimers();
    try {
      const { client } = makeServiceClient({
        rowResult: { data: PENDING_ROW, error: null },
        updateResult: { data: PENDING_ROW, error: null },
      });
      createServiceClient.mockResolvedValue(client);
      resolveTxt.mockReturnValue(new Promise(() => {}));

      const pending = call();
      await vi.advanceTimersByTimeAsync(6_000);
      const res = await pending;

      expect(res.status).toBe(200);
      expect((await res.json()).diagnostic).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("429s on the per-org window before reading the row or DNS", async () => {
    const { client, calls } = makeServiceClient({
      countResult: { count: 10, error: null },
      rowResult: { data: PENDING_ROW, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(429);
    expect(calls.countEq).toEqual([["org_id", "org-1"]]);
    expect(calls.rowEq).toEqual([]);
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it("429s on the per-row cooldown when the row was checked seconds ago", async () => {
    const { client, calls } = makeServiceClient({
      rowResult: { data: { ...PENDING_ROW, last_checked_at: new Date().toISOString() }, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(429);
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  it("fails open on a broken rate-limit count", async () => {
    const { client } = makeServiceClient({
      countResult: { count: null, error: { message: "count broke" } },
      rowResult: { data: PENDING_ROW, error: null },
      updateResult: { data: PENDING_ROW, error: null },
    });
    createServiceClient.mockResolvedValue(client);
    resolveTxt.mockResolvedValue([["abc123token"]]);

    const res = await call();

    expect(res.status).toBe(200);
  });

  it("reports the reclaim block (23505 on the verified transition) as 'being released', not a DNS failure", async () => {
    const { client } = makeServiceClient({
      rowResult: { data: PENDING_ROW, error: null },
      updateResult: { data: null, error: { code: "23505" } },
    });
    createServiceClient.mockResolvedValue(client);
    resolveTxt.mockResolvedValue([["abc123token"]]);

    const res = await call();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/being released/);
    expect(body.error).not.toMatch(/TXT|DNS/);
  });

  it("500s when the row lookup itself errors", async () => {
    const { client } = makeServiceClient({ rowResult: { data: null, error: { message: "db down" } } });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(500);
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it("500s when the mismatch-path last_checked_at stamp itself errors", async () => {
    const { client } = makeServiceClient({
      rowResult: { data: PENDING_ROW, error: null },
      updateResult: { data: null, error: { message: "db down" } },
    });
    createServiceClient.mockResolvedValue(client);
    resolveTxt.mockResolvedValue([["wrong-token"]]);

    const res = await call();

    expect(res.status).toBe(500);
  });

  it("500s via the outer catch on an unexpected exception", async () => {
    createServiceClient.mockResolvedValue({
      from() {
        throw new Error("unexpected");
      },
    });

    const res = await call();

    expect(res.status).toBe(500);
  });

  it("404s for a row outside the caller's org (fetch is org-scoped)", async () => {
    const { client } = makeServiceClient({ rowResult: { data: null, error: null } });
    createServiceClient.mockResolvedValue(client);

    const res = await call("someone-elses-row");

    expect(res.status).toBe(404);
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it("409s for a row already in 'removing' without a DNS lookup", async () => {
    const { client } = makeServiceClient({
      rowResult: { data: { ...PENDING_ROW, status: "removing" }, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(409);
    expect(resolveTxt).not.toHaveBeenCalled();
  });

  it("is a no-op for an already-verified row (no DNS, no write)", async () => {
    const { client, calls } = makeServiceClient({
      rowResult: { data: { ...PENDING_ROW, status: "verified" }, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
    expect(resolveTxt).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  it("401s / 403s from the gate without touching the service client", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await call();
    expect(res.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
