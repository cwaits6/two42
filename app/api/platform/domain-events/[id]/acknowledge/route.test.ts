// Unit tests for the platform acknowledge route. The security-relevant
// properties: the write is scoped on the row's own org_id (resolved from
// the row, never from the caller) and on acknowledged_at IS NULL, and row
// count — not the absence of an error — decides whether it acknowledged.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { POST } = await import("@/app/api/platform/domain-events/[id]/acknowledge/route");

function makeServiceClient(opts: {
  rowResult?: { data: unknown; error: unknown };
  updateResult?: { data: unknown[] | null; error: unknown };
}) {
  const calls = { filters: [] as Array<[string, ...unknown[]]> };
  const client = {
    from() {
      return {
        select() {
          const chain = {
            eq() {
              return chain;
            },
            maybeSingle: async () =>
              opts.rowResult ?? { data: { id: "evt-1", org_id: "org-9" }, error: null },
          };
          return chain;
        },
        update() {
          const chain = {
            eq(col: string, val: unknown) {
              calls.filters.push(["eq", col, val]);
              return chain;
            },
            is(col: string, val: unknown) {
              calls.filters.push(["is", col, val]);
              return chain;
            },
            select: async () => opts.updateResult ?? { data: [{ id: "evt-1" }], error: null },
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function call(id = "evt-1") {
  return POST(new Request(`http://localhost/api/platform/domain-events/${id}/acknowledge`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  requirePlatformAdmin.mockReset();
  createServiceClient.mockReset();
  requirePlatformAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/platform/domain-events/[id]/acknowledge", () => {
  it("stamps acknowledged_at scoped on the row's own org_id and acknowledged_at IS NULL", async () => {
    const { client, calls } = makeServiceClient({});
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, acknowledged: true });
    expect(calls.filters).toEqual([
      ["eq", "id", "evt-1"],
      ["eq", "org_id", "org-9"],
      ["is", "acknowledged_at", null],
    ]);
  });

  it("reports acknowledged:false (200) on a second click — zero rows matched, not a re-stamp", async () => {
    const { client } = makeServiceClient({ updateResult: { data: [], error: null } });
    createServiceClient.mockResolvedValue(client);

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, acknowledged: false });
  });

  it("404s when the event does not exist", async () => {
    const { client } = makeServiceClient({ rowResult: { data: null, error: null } });
    createServiceClient.mockResolvedValue(client);

    expect((await call("missing")).status).toBe(404);
  });

  it("401s / 403s from the gate without touching the service client", async () => {
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await call()).status).toBe(401);
    requirePlatformAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await call()).status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("500s when the row lookup errors", async () => {
    const { client } = makeServiceClient({ rowResult: { data: null, error: { message: "db down" } } });
    createServiceClient.mockResolvedValue(client);

    expect((await call()).status).toBe(500);
  });

  it("500s on an update error", async () => {
    const { client } = makeServiceClient({ updateResult: { data: null, error: { message: "boom" } } });
    createServiceClient.mockResolvedValue(client);

    expect((await call()).status).toBe(500);
  });
});
