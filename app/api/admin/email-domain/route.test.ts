// Unit tests for the claim/read/remove routes. The failure paths are the
// thing worth pinning: a Resend domain must never be left orphaned with no
// DB trace when the surrounding DB write fails, in either direction
// (insert-then-create, or create-then-update) — and when the Resend cleanup
// itself fails, the row must survive as cleanup_pending rather than be
// deleted. Also covers the platform-operator gate and the platform-wide
// cap, both of which must refuse before Resend is touched. Mocks
// createServiceClient, requireOrgAdmin, and the Resend SDK with a chainable
// stub for `.from().select()/.insert()/.delete()/.update()` chains.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const domainsCreate = vi.fn();
const domainsRemove = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    domains = {
      create: (...args: unknown[]) => domainsCreate(...args),
      remove: (...args: unknown[]) => domainsRemove(...args),
    };
  },
}));

const { GET, POST, DELETE, DOMAIN_SHAPE } = await import(
  "@/app/api/admin/email-domain/route"
);

type EqCall = [string, unknown];

interface ExistingRow {
  id?: string;
  status?: string;
  resend_domain_id?: string | null;
}

interface ServiceClientOptions {
  /** organizations.custom_email_domain_enabled read. Defaults to enabled. */
  orgResult?: {
    data: { custom_email_domain_enabled: boolean } | null;
    error: unknown;
  };
  /** The org's own org_email_domains row. Defaults to none. */
  existingResult?: { data: ExistingRow | null; error: unknown };
  /** The platform-wide head count of claimed domains. Defaults to 0. */
  countResult?: { count: number | null; error: unknown };
  insertResult?: { data: { id: string } | null; error: unknown };
  /**
   * count defaults to 1 (a matched row) when omitted, so existing fixtures
   * that don't care about affected-row count keep behaving as "matched".
   */
  updateResult?: { data: unknown; error: unknown; count?: number | null };
  /**
   * Reject the FIRST update only (the post-create write that records
   * Resend's id), so a later cleanup_pending write in the same request can
   * still land and be asserted on.
   */
  updateRejects?: Error;
  deleteResult?: { error: unknown; count?: number | null };
}

function chain(track: EqCall[], terminal: unknown) {
  const obj = {
    eq(col: string, val: unknown) {
      track.push([col, val]);
      return obj;
    },
    select() {
      return obj;
    },
    single: async () => terminal,
    maybeSingle: async () => terminal,
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(terminal).then(resolve, reject);
    },
  };
  return obj;
}

function makeServiceClient(opts: ServiceClientOptions = {}) {
  const calls = {
    insertPayload: undefined as unknown,
    deleteEq: [] as EqCall[],
    deleteCount: 0,
    updatePayloads: [] as unknown[],
    updateEq: [] as EqCall[],
    selectEq: [] as EqCall[],
    countQueries: 0,
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
            opts.orgResult ?? {
              data: { custom_email_domain_enabled: true },
              error: null,
            },
        };
      }
      if (table !== "org_email_domains") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select(_cols: string, options?: { head?: boolean }) {
          if (options?.head) {
            calls.countQueries += 1;
            return chain([], opts.countResult ?? { count: 0, error: null });
          }
          return chain(
            calls.selectEq,
            opts.existingResult ?? { data: null, error: null },
          );
        },
        insert(payload: unknown) {
          calls.insertPayload = payload;
          return {
            select() {
              return this;
            },
            single: async () =>
              opts.insertResult ?? { data: { id: "row-1" }, error: null },
          };
        },
        delete() {
          calls.deleteCount += 1;
          return chain(
            calls.deleteEq,
            opts.deleteResult ?? { error: null, count: 1 },
          );
        },
        update(payload: unknown) {
          calls.updatePayloads.push(payload);
          if (opts.updateRejects && calls.updatePayloads.length === 1) {
            // A pre-rejected promise as the chain terminal: chain's single()
            // unwraps it on await, simulating a thrown (network-level)
            // failure rather than a returned { error }. The noop catch marks
            // it handled so vitest doesn't flag the rejection before the
            // route awaits it.
            const rejection = Promise.reject(opts.updateRejects);
            rejection.catch(() => {});
            return chain(calls.updateEq, rejection);
          }
          return chain(
            calls.updateEq,
            opts.updateResult ?? { data: null, error: null, count: 1 },
          );
        },
      };
    },
  };

  return { client, calls };
}

// The request-scoped client requireOrgAdmin() hands back, used by GET's
// RLS-bounded row read.
function makeRequestClient(rowResult: { data: unknown; error: unknown }) {
  return {
    from() {
      return {
        select() {
          return { maybeSingle: async () => rowResult };
        },
      };
    },
  };
}

function claimRequest(domain = "mail.example.church") {
  return new Request("http://localhost/api/admin/email-domain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
}

const resendCreated = {
  data: { id: "rd-1", status: "pending", records: [] },
  error: null,
};

beforeEach(() => {
  requireOrgAdmin.mockReset();
  createServiceClient.mockReset();
  domainsCreate.mockReset();
  domainsRemove.mockReset();
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ORG_EMAIL_DOMAIN_CAP;
});

describe("POST /api/admin/email-domain — gates", () => {
  it("403s with a contact-support message, before the DB row or Resend, when custom domains are not enabled for the org", async () => {
    const { client, calls } = makeServiceClient({
      orgResult: { data: { custom_email_domain_enabled: false }, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/contact support/i);
    expect(calls.insertPayload).toBeUndefined();
    expect(calls.countQueries).toBe(0);
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("fails closed with a 500 when the org flag cannot be read", async () => {
    const { client, calls } = makeServiceClient({
      orgResult: { data: null, error: { message: "read failed" } },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("403s with a contact-support message when the platform-wide domain cap is reached", async () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "3";
    const { client, calls } = makeServiceClient({
      countResult: { count: 3, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/contact support/i);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("proceeds while the count is below the cap", async () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "3";
    const { client } = makeServiceClient({
      countResult: { count: 2, error: null },
      updateResult: { data: { id: "row-1" }, error: null },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);

    const res = await POST(claimRequest());

    expect(res.status).toBe(200);
    expect(domainsCreate).toHaveBeenCalled();
  });

  it("fails closed with a 500 when the cap count cannot be read", async () => {
    const { client, calls } = makeServiceClient({
      countResult: { count: null, error: { message: "count failed" } },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("409s with a cleanup-in-progress message, never touching Resend, while the org's previous removal is still pending", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-0", status: "cleanup_pending", resend_domain_id: "rd-0" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still completing/i);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
    expect(domainsRemove).not.toHaveBeenCalled();
  });

  it("409s for the org's own stuck cleanup even when the platform is separately at cap", async () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "3";
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-0", status: "cleanup_pending", resend_domain_id: "rd-0" },
        error: null,
      },
      countResult: { count: 3, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/still completing/i);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("409s on a duplicate claim without touching Resend", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-0", status: "verified", resend_domain_id: "rd-0" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/remove it first/i);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("409s when the insert loses the race to the unique-per-org index", async () => {
    const { client } = makeServiceClient({
      insertResult: { data: null, error: { code: "23505" } },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(409);
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("400s on a malformed domain before touching the DB or Resend", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest("not a domain"));

    expect(res.status).toBe(400);
    expect(calls.insertPayload).toBeUndefined();
    expect(domainsCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/email-domain — claim and rollback", () => {
  it("rolls back the insert when Resend domains.create fails", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue({
      data: null,
      error: { message: "Resend rejected the domain" },
    });

    const res = await POST(claimRequest());

    expect(res.status).toBe(502);
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    expect(domainsRemove).not.toHaveBeenCalled();
  });

  it("does not roll back when create and the follow-up update both succeed", async () => {
    const { client, calls } = makeServiceClient({
      updateResult: {
        data: { id: "row-1", domain: "mail.example.church", status: "pending" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);

    const res = await POST(claimRequest());

    expect(res.status).toBe(200);
    expect(calls.deleteCount).toBe(0);
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.updatePayloads[0]).toMatchObject({ resend_domain_id: "rd-1" });
  });

  it("cleans up both the Resend domain and the DB row when the post-create update fails", async () => {
    const { client, calls } = makeServiceClient({
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    // Resend cleanup: the domain the failed update never recorded must not
    // be left orphaned in the org's Resend account.
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    // DB rollback: mirrors the insert-failure branch, scoped the same way.
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("keeps the row as cleanup_pending (with resend_domain_id) when the post-create update fails and the Resend cleanup returns an error", async () => {
    const { client, calls } = makeServiceClient({
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "try later" },
    });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    // The row is the only durable record of the orphaned Resend domain.
    expect(calls.deleteCount).toBe(0);
    expect(calls.updatePayloads[1]).toMatchObject({
      resend_domain_id: "rd-1",
      status: "cleanup_pending",
    });
    expect((calls.updatePayloads[1] as { cleanup_failed_at: unknown }).cleanup_failed_at).toEqual(
      expect.any(String),
    );
    expect(calls.updateEq.slice(-2)).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it("logs distinctly when the cleanup_pending marker update affects zero rows (row raced away by a concurrent cleanup)", async () => {
    const { client } = makeServiceClient({
      updateResult: { data: null, error: null, count: 0 },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "try later" },
    });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/cleanup_pending/i),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("treats a not_found from Resend as already cleaned up and rolls the row back", async () => {
    const { client, calls } = makeServiceClient({
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockResolvedValue({
      error: { name: "not_found", message: "Domain not found" },
    });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(calls.deleteCount).toBe(1);
    expect(calls.updatePayloads).toHaveLength(1);
  });

  it("removes the Resend domain and rolls back the insert when the post-create update throws", async () => {
    const { client, calls } = makeServiceClient({
      updateRejects: new Error("network reset"),
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    // The catch path must clean up the provider side too: the Resend domain
    // exists but no DB row will record it after the rollback below.
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("marks the row cleanup_pending (keeping resend_domain_id) instead of deleting it when the catch-path Resend cleanup itself throws", async () => {
    const { client, calls } = makeServiceClient({
      updateRejects: new Error("network reset"),
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue(resendCreated);
    domainsRemove.mockRejectedValue(new Error("resend also unreachable"));

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    expect(calls.deleteCount).toBe(0);
    expect(calls.updatePayloads).toHaveLength(2);
    expect(calls.updatePayloads[1]).toMatchObject({
      resend_domain_id: "rd-1",
      status: "cleanup_pending",
    });
    expect(calls.updateEq.slice(-2)).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it("rolls back the insert and returns 500 when domains.create throws instead of resolving", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockRejectedValue(new Error("network reset"));

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    // Nothing was created on Resend's side, so there is nothing to remove
    // and no reason to keep the row.
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });
});

describe("DELETE /api/admin/email-domain", () => {
  it("removes the Resend domain, then deletes the row scoped on (id, org_id)", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-1", resend_domain_id: "rd-1", status: "verified" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    expect(calls.selectEq).toEqual([["org_id", "org-1"]]);
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("keeps the row as cleanup_pending and 502s when the Resend removal fails", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-1", resend_domain_id: "rd-1", status: "verified" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "try later" },
    });

    const res = await DELETE();

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/still reserved/i);
    expect(calls.deleteCount).toBe(0);
    expect(calls.updatePayloads[0]).toMatchObject({
      resend_domain_id: "rd-1",
      status: "cleanup_pending",
    });
    expect(calls.updateEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("completes a stuck cleanup: a cleanup_pending row is deleted once the Resend removal succeeds", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-1", resend_domain_id: "rd-1", status: "cleanup_pending" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
    expect(calls.deleteCount).toBe(1);
    expect(calls.updatePayloads).toHaveLength(0);
  });

  it("deletes a row that never reached Resend without calling remove", async () => {
    const { client, calls } = makeServiceClient({
      existingResult: {
        data: { id: "row-1", resend_domain_id: null, status: "not_started" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.deleteCount).toBe(1);
  });

  it("404s when there is no row to remove", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await DELETE();

    expect(res.status).toBe(404);
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.deleteCount).toBe(0);
  });

  it("404s when the scoped delete affects zero rows", async () => {
    const { client } = makeServiceClient({
      existingResult: {
        data: { id: "row-1", resend_domain_id: "rd-1", status: "verified" },
        error: null,
      },
      deleteResult: { error: null, count: 0 },
    });
    createServiceClient.mockResolvedValue(client);
    domainsRemove.mockResolvedValue({ error: null });

    const res = await DELETE();

    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/email-domain", () => {
  const row = {
    id: "row-1",
    domain: "mail.example.church",
    status: "pending",
    dns_records: [],
    verified_at: null,
    last_checked_at: null,
    cleanup_failed_at: null,
    created_at: "2026-09-01T00:00:00.000Z",
  };

  it("returns the org's enablement flag and its row", async () => {
    requireOrgAdmin.mockResolvedValue({
      ok: true,
      orgId: "org-1",
      supabase: makeRequestClient({ data: row, error: null }),
    });
    createServiceClient.mockResolvedValue(makeServiceClient().client);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, data: row });
  });

  it("returns enabled: false and no row for a disabled, unclaimed org", async () => {
    requireOrgAdmin.mockResolvedValue({
      ok: true,
      orgId: "org-1",
      supabase: makeRequestClient({ data: null, error: null }),
    });
    createServiceClient.mockResolvedValue(
      makeServiceClient({
        orgResult: { data: { custom_email_domain_enabled: false }, error: null },
      }).client,
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, data: null });
  });

  it("500s rather than guessing when the flag cannot be read", async () => {
    requireOrgAdmin.mockResolvedValue({
      ok: true,
      orgId: "org-1",
      supabase: makeRequestClient({ data: row, error: null }),
    });
    createServiceClient.mockResolvedValue(
      makeServiceClient({
        orgResult: { data: null, error: { message: "read failed" } },
      }).client,
    );

    const res = await GET();

    expect(res.status).toBe(500);
  });

  it("401s when there is no signed-in admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("DOMAIN_SHAPE", () => {
  it.each([
    "mail.example.church",
    "a.bc",
    "sub.sub.example.org",
  ])("accepts %s", (d) => expect(DOMAIN_SHAPE.test(d)).toBe(true));

  it.each([
    "",
    "a.b",
    "example",
    "-example.com",
    "example-.com",
    "example..com",
    "example.com.",
    "EXAMPLE.COM",
    "a".repeat(64) + ".com",
    "a".repeat(250) + ".com",
  ])("rejects %s", (d) => expect(DOMAIN_SHAPE.test(d)).toBe(false));
});
