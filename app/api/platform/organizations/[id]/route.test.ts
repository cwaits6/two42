// Unit tests for the platform organization PATCH route. This is the sole
// write path for organizations.custom_email_domain_enabled — a column with
// no grant to the org's own admin — so the boolean-type check and the
// merged "nothing to update" gate are security-relevant, not just
// validation polish. Reuses the chainable-stub pattern established by
// app/api/platform/organizations/[id]/email-cap/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { PATCH } = await import("@/app/api/platform/organizations/[id]/route");

interface ServiceClientOptions {
  brandingReadResult?: { data: { branding: unknown } | null; error: unknown };
  updateResult?: { data: unknown[] | null; error: unknown };
}

function makeServiceClient(opts: ServiceClientOptions = {}) {
  const calls = {
    updatePayload: undefined as unknown,
    updateEq: [] as [string, unknown][],
  };

  const client = {
    from(table: string) {
      if (table !== "organizations") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () =>
                  opts.brandingReadResult ?? {
                    data: { branding: {} },
                    error: null,
                  },
              };
            },
          };
        },
        update(payload: unknown) {
          calls.updatePayload = payload;
          return {
            eq(col: string, val: unknown) {
              calls.updateEq.push([col, val]);
              return {
                select: async () =>
                  opts.updateResult ?? { data: [{ id: "org-1" }], error: null },
              };
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

function request(body: unknown) {
  return new Request("http://localhost/api/platform/organizations/org-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

describe("PATCH /api/platform/organizations/[id]", () => {
  it("401s when requirePlatformAdmin finds no signed-in user, before touching the service client", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 401 });
    const res = await PATCH(
      request({ custom_email_domain_enabled: true }),
      routeParams(),
    );
    expect(res.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("403s when the signed-in user is not a platform admin", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 403 });
    const res = await PATCH(
      request({ custom_email_domain_enabled: true }),
      routeParams(),
    );
    expect(res.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("400s when custom_email_domain_enabled is not a boolean", async () => {
    const { client } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ custom_email_domain_enabled: "true" }),
      routeParams(),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/must be true or false/i);
  });

  it("persists custom_email_domain_enabled alone", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ custom_email_domain_enabled: true }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(calls.updatePayload).toEqual({ custom_email_domain_enabled: true });
    expect(calls.updateEq).toEqual([["id", "org-1"]]);
  });

  it("400s with 'Nothing to update' for an empty body, without touching the service client", async () => {
    const res = await PATCH(request({}), routeParams());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nothing to update/i);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("400s on an invalid status value", async () => {
    const res = await PATCH(request({ status: "deleted" }), routeParams());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/active or suspended/i);
  });

  it("persists status alone", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(request({ status: "suspended" }), routeParams());

    expect(res.status).toBe(200);
    expect(calls.updatePayload).toEqual({ status: "suspended" });
  });

  it("merges a branding patch onto the existing branding rather than replacing it", async () => {
    const { client, calls } = makeServiceClient({
      brandingReadResult: {
        data: { branding: { display_name: "Old Name", accent: "#111111" } },
        error: null,
      },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ branding: { accent: "#B85C38" } }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(calls.updatePayload).toEqual({
      branding: { display_name: "Old Name", accent: "#B85C38" },
    });
  });

  it("404s when the branding read finds no organization", async () => {
    const { client } = makeServiceClient({
      brandingReadResult: { data: null, error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ branding: { accent: "#B85C38" } }),
      routeParams(),
    );

    expect(res.status).toBe(404);
  });

  it("persists all three fields together in one merged update", async () => {
    const { client, calls } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({
        status: "active",
        custom_email_domain_enabled: false,
        branding: { accent: "#B85C38" },
      }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(calls.updatePayload).toMatchObject({
      status: "active",
      custom_email_domain_enabled: false,
      branding: { accent: "#B85C38" },
    });
  });

  it("404s when the scoped update affects zero rows", async () => {
    const { client } = makeServiceClient({
      updateResult: { data: [], error: null },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ custom_email_domain_enabled: true }),
      routeParams(),
    );

    expect(res.status).toBe(404);
  });

  it("500s and logs when the update errors", async () => {
    const { client } = makeServiceClient({
      updateResult: { data: null, error: { message: "db write failed" } },
    });
    createServiceClient.mockResolvedValue(client);

    const res = await PATCH(
      request({ custom_email_domain_enabled: true }),
      routeParams(),
    );

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });
});
