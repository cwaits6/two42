// Unit tests for the platform retry of a stuck email-domain cleanup. The
// contract worth pinning: the row is deleted only after Resend confirms the
// domain is gone, and a failed retry leaves the row in place (bumping
// cleanup_failed_at) so the orphaned resend_domain_id is never lost. Reuses
// the chainable-stub pattern from app/api/admin/email-domain/route.test.ts
// and the table switch from email-cap/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const domainsRemove = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    domains = {
      remove: (...args: unknown[]) => domainsRemove(...args),
    };
  },
}));

const { POST } = await import(
  "@/app/api/platform/organizations/[id]/email-domain-cleanup/route"
);

type EqCall = [string, unknown];

interface ServiceClientOptions {
  orgResult?: { data: { id: string } | null; error: unknown };
  rowResult?: {
    data: { id: string; resend_domain_id: string | null; status: string } | null;
    error: unknown;
  };
  /** count defaults to 1 (a matched row) when omitted. */
  updateResult?: { error: unknown; count?: number | null };
  deleteResult?: { error: unknown; count?: number | null };
}

function chain(track: EqCall[], terminal: unknown) {
  const obj = {
    eq(col: string, val: unknown) {
      track.push([col, val]);
      return obj;
    },
    maybeSingle: async () => terminal,
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(terminal).then(resolve, reject);
    },
  };
  return obj;
}

function makeServiceClient(opts: ServiceClientOptions = {}) {
  const calls = {
    selectEq: [] as EqCall[],
    updatePayload: undefined as unknown,
    updateEq: [] as EqCall[],
    deleteCount: 0,
    deleteEq: [] as EqCall[],
  };

  const client = {
    from(table: string) {
      if (table === "organizations") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () =>
            opts.orgResult ?? { data: { id: "org-1" }, error: null },
        };
      }
      if (table === "org_email_domains") {
        return {
          select() {
            return chain(
              calls.selectEq,
              opts.rowResult ?? {
                data: { id: "row-1", resend_domain_id: "rd-1", status: "cleanup_pending" },
                error: null,
              },
            );
          },
          update(payload: unknown) {
            calls.updatePayload = payload;
            return chain(
              calls.updateEq,
              opts.updateResult ?? { error: null, count: 1 },
            );
          },
          delete() {
            calls.deleteCount += 1;
            return chain(calls.deleteEq, opts.deleteResult ?? { error: null, count: 1 });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, calls };
}

function request() {
  return new Request(
    "http://localhost/api/platform/organizations/org-1/email-domain-cleanup",
    { method: "POST" }
  );
}

function routeParams(id = "org-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requirePlatformAdmin.mockReset();
  createServiceClient.mockReset();
  domainsRemove.mockReset();
  requirePlatformAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/platform/organizations/[id]/email-domain-cleanup", () => {
  it("401s when requirePlatformAdmin finds no signed-in user", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("403s when the signed-in user is not a platform admin", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("404s when the org does not exist, without touching Resend", async () => {
    const { client } = makeServiceClient({
      orgResult: { data: null, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(404);
    expect(domainsRemove).not.toHaveBeenCalled();
  });

  it("404s when the org has no cleanup_pending row, without touching Resend", async () => {
    const { client, calls } = makeServiceClient({
      rowResult: {
        data: { id: "row-1", resend_domain_id: "rd-1", status: "verified" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(404);
    expect(calls.selectEq).toEqual([["org_id", "org-1"]]);
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.deleteCount).toBe(0);
  });

  it("404s when the org has no row at all", async () => {
    const { client } = makeServiceClient({
      rowResult: { data: null, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(404);
    expect(domainsRemove).not.toHaveBeenCalled();
  });

  it("removes the Resend domain, then deletes the row scoped on (id, org_id)", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("treats a not_found from Resend as already gone and deletes the row", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({
      error: { name: "not_found", message: "Domain not found" },
    });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(200);
    expect(calls.deleteCount).toBe(1);
  });

  it("keeps the row, bumps cleanup_failed_at, and 502s when the Resend removal fails", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "try later" },
    });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(502);
    expect(calls.deleteCount).toBe(0);
    expect(calls.updatePayload).toEqual({ cleanup_failed_at: expect.any(String) });
    expect(calls.updateEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("logs distinctly when the attempt-timestamp update affects zero rows (row raced away by a concurrent cleanup)", async () => {
    const { client } = makeServiceClient({
      updateResult: { error: null, count: 0 },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "try later" },
    });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(502);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/matched no row/i),
      "org-1",
      "row-1",
    );
  });

  it("keeps the row and 502s when the Resend removal throws", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockRejectedValue(new Error("network reset"));

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(502);
    expect(calls.deleteCount).toBe(0);
    expect(calls.updatePayload).toEqual({ cleanup_failed_at: expect.any(String) });
  });

  it("404s when the scoped delete affects zero rows (silent no-op guard)", async () => {
    const { client } = makeServiceClient({
      deleteResult: { error: null, count: 0 },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await POST(request(), routeParams());

    expect(res.status).toBe(404);
  });
});
