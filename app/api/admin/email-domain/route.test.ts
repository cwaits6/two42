// Unit tests for the claim/remove routes (CWA-70). The rollback-on-failure
// paths are the thing this PR's own review scope calls out as needing
// verification: a Resend domain must never be left orphaned (unlogged, and
// with no DB trace) when the surrounding DB write fails, in either
// direction (insert-then-create, or create-then-update). Mocks
// createServiceClient, requireOrgAdmin, and the Resend SDK — this repo has
// no prior route-test precedent, so the chainable stub below establishes
// one for `.from().insert()/.delete()/.update()` chains.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { POST, DOMAIN_SHAPE } = await import(
  "@/app/api/admin/email-domain/route"
);

type EqCall = [string, unknown];

interface ServiceClientOptions {
  insertResult: { data: { id: string } | null; error: unknown };
  updateResult?: { data: unknown; error: unknown };
  deleteResult?: { error: unknown };
}

function eqChain(track: EqCall[], terminal: unknown) {
  const obj = {
    eq(col: string, val: unknown) {
      track.push([col, val]);
      return obj;
    },
    select() {
      return obj;
    },
    single: async () => terminal,
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(terminal).then(resolve, reject);
    },
  };
  return obj;
}

function makeServiceClient(opts: ServiceClientOptions) {
  const calls = {
    insertPayload: undefined as unknown,
    deleteEq: [] as EqCall[],
    deleteCount: 0,
    updatePayload: undefined as unknown,
    updateEq: [] as EqCall[],
  };

  const client = {
    from() {
      return {
        insert(payload: unknown) {
          calls.insertPayload = payload;
          return {
            select() {
              return this;
            },
            single: async () => opts.insertResult,
          };
        },
        delete() {
          calls.deleteCount += 1;
          return eqChain(calls.deleteEq, opts.deleteResult ?? { error: null });
        },
        update(payload: unknown) {
          calls.updatePayload = payload;
          return eqChain(
            calls.updateEq,
            opts.updateResult ?? { data: null, error: null },
          );
        },
      };
    },
  };

  return { client, calls };
}

function claimRequest(domain = "mail.example.church") {
  return new Request("http://localhost/api/admin/email-domain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
}

beforeEach(() => {
  requireOrgAdmin.mockReset();
  createServiceClient.mockReset();
  domainsCreate.mockReset();
  domainsRemove.mockReset();
  requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/email-domain", () => {
  it("rolls back the insert when Resend domains.create fails", async () => {
    const { client, calls } = makeServiceClient({
      insertResult: { data: { id: "row-1" }, error: null },
    });
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
      insertResult: { data: { id: "row-1" }, error: null },
      updateResult: {
        data: { id: "row-1", domain: "mail.example.church", status: "pending" },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue({
      data: { id: "rd-1", status: "pending", records: [] },
      error: null,
    });

    const res = await POST(claimRequest());

    expect(res.status).toBe(200);
    expect(calls.deleteCount).toBe(0);
    expect(domainsRemove).not.toHaveBeenCalled();
    expect(calls.updatePayload).toMatchObject({ resend_domain_id: "rd-1" });
  });

  it("cleans up both the Resend domain and the DB row when the post-create update fails", async () => {
    const { client, calls } = makeServiceClient({
      insertResult: { data: { id: "row-1" }, error: null },
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue({
      data: { id: "rd-1", status: "pending", records: [] },
      error: null,
    });
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

  it("logs but still returns 500 if the Resend cleanup call itself fails", async () => {
    const { client } = makeServiceClient({
      insertResult: { data: { id: "row-1" }, error: null },
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockResolvedValue({
      data: { id: "rd-1", status: "pending", records: [] },
      error: null,
    });
    domainsRemove.mockResolvedValue({ error: { message: "already gone" } });

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });

  it("rolls back the insert and returns 500 when domains.create throws instead of resolving", async () => {
    const { client, calls } = makeServiceClient({
      insertResult: { data: { id: "row-1" }, error: null },
    });
    createServiceClient.mockResolvedValue(client);
    domainsCreate.mockRejectedValue(new Error("network reset"));

    const res = await POST(claimRequest());

    expect(res.status).toBe(500);
    expect(calls.deleteCount).toBe(1);
    expect(calls.deleteEq).toEqual([
      ["id", "row-1"],
      ["org_id", "org-1"],
    ]);
  });

  it("409s without touching Resend on a duplicate claim", async () => {
    const { client } = makeServiceClient({
      insertResult: { data: null, error: { code: "23505" } },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await POST(claimRequest());

    expect(res.status).toBe(409);
    expect(domainsCreate).not.toHaveBeenCalled();
  });

  it("400s on a malformed domain before touching the DB or Resend", async () => {
    createServiceClient.mockResolvedValue(makeServiceClient({
      insertResult: { data: { id: "row-1" }, error: null },
    }).client);

    const res = await POST(claimRequest("not a domain"));

    expect(res.status).toBe(400);
    expect(domainsCreate).not.toHaveBeenCalled();
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
