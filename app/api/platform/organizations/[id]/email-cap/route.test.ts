// Unit tests for the platform email-cap override route (CWA-72). This is
// the one brand-new /platform write in the PR with a genuinely novel,
// security-relevant guard (the zero-row-write check on the upsert) and no
// prior coverage — reuses the chainable-stub pattern established by
// app/api/admin/email-domain/route.test.ts (CWA-70) for
// `.from().select().eq().maybeSingle()` / `.from().upsert().select()`
// chains against a mocked service client.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DAILY_EMAIL_CAP } from "@/lib/email/quota";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { PATCH } = await import(
  "@/app/api/platform/organizations/[id]/email-cap/route"
);

interface ServiceClientOptions {
  orgResult?: { data: { id: string } | null; error: unknown };
  upsertResult?: { data: unknown[] | null; error: unknown };
}

function makeServiceClient(opts: ServiceClientOptions) {
  const calls = {
    upsertPayload: undefined as unknown,
    upsertOptions: undefined as unknown,
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
      if (table === "org_email_limits") {
        return {
          upsert(payload: unknown, options: unknown) {
            calls.upsertPayload = payload;
            calls.upsertOptions = options;
            return {
              select: async () =>
                opts.upsertResult ?? { data: [{ org_id: "org-1" }], error: null },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, calls };
}

function patchRequest(body: unknown) {
  return new Request(
    "http://localhost/api/platform/organizations/org-1/email-cap",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function routeParams(id = "org-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requirePlatformAdmin.mockReset();
  createServiceClient.mockReset();
  requirePlatformAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/platform/organizations/[id]/email-cap", () => {
  it("404s when the org does not exist", async () => {
    const { client } = makeServiceClient({
      orgResult: { data: null, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(patchRequest({ daily_cap: 100 }), routeParams());

    expect(res.status).toBe(404);
  });

  it("400s on a non-integer daily_cap", async () => {
    createServiceClient.mockResolvedValue(makeServiceClient({}).client);

    const res = await PATCH(patchRequest({ daily_cap: 1.5 }), routeParams());

    expect(res.status).toBe(400);
  });

  it("400s on a daily_cap above MAX_DAILY_EMAIL_CAP", async () => {
    createServiceClient.mockResolvedValue(makeServiceClient({}).client);

    const res = await PATCH(
      patchRequest({ daily_cap: MAX_DAILY_EMAIL_CAP + 1 }),
      routeParams()
    );

    expect(res.status).toBe(400);
  });

  it("400s on a negative daily_cap", async () => {
    createServiceClient.mockResolvedValue(makeServiceClient({}).client);

    const res = await PATCH(patchRequest({ daily_cap: -1 }), routeParams());

    expect(res.status).toBe(400);
  });

  it("accepts daily_cap = 0 (fully throttled)", async () => {
    const { client, calls } = makeServiceClient({});
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(patchRequest({ daily_cap: 0 }), routeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(calls.upsertPayload).toMatchObject({ org_id: "org-1", daily_cap: 0 });
  });

  it("accepts daily_cap = MAX_DAILY_EMAIL_CAP (upper boundary)", async () => {
    const { client } = makeServiceClient({});
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      patchRequest({ daily_cap: MAX_DAILY_EMAIL_CAP }),
      routeParams()
    );

    expect(res.status).toBe(200);
  });

  it("500s when the upsert affects zero rows (silent no-op guard)", async () => {
    const { client } = makeServiceClient({
      upsertResult: { data: [], error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(patchRequest({ daily_cap: 50 }), routeParams());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toEqual({ success: true });
  });

  it("401s when requirePlatformAdmin finds no signed-in user", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ daily_cap: 50 }), routeParams());

    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("403s when the signed-in user is not a platform admin", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 403 });

    const res = await PATCH(patchRequest({ daily_cap: 50 }), routeParams());

    expect(res.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON before touching the DB", async () => {
    const req = new Request(
      "http://localhost/api/platform/organizations/org-1/email-cap",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "not json" }
    );

    const res = await PATCH(req, routeParams());

    expect(res.status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
