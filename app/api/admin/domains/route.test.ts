// Unit tests for the claim route. It runs on the request client only, so
// the thing worth pinning is what it refuses before the insert (shape,
// platform apex) and that the insert names `domain` alone — org_id must
// come from the fail-closed column DEFAULT, never the payload.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOMAIN_SHAPE } from "@/lib/domains";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

vi.mock("@/lib/config", () => ({
  siteConfig: { platformApex: "two42.io" },
}));

const { POST } = await import("@/app/api/admin/domains/route");

function makeRequestClient(insertResult: { data: unknown; error: unknown }) {
  const calls = { insertPayload: undefined as unknown, insertCount: 0 };
  const client = {
    from() {
      return {
        insert(payload: unknown) {
          calls.insertCount += 1;
          calls.insertPayload = payload;
          return {
            select() {
              return this;
            },
            single: async () => insertResult,
          };
        },
      };
    },
  };
  return { client, calls };
}

function claimRequest(domain: unknown) {
  return new Request("http://localhost/api/admin/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
}

const ROW = { id: "row-1", domain: "example.church", status: "pending" };

beforeEach(() => {
  requireOrgAdmin.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/domains", () => {
  it("inserts `domain` alone on the request client and returns the row", async () => {
    const { client, calls } = makeRequestClient({ data: ROW, error: null });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    const res = await POST(claimRequest("Example.Church."));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: ROW });
    // Normalised (lowercase, trailing dot stripped) and nothing but domain.
    expect(calls.insertPayload).toEqual({ domain: "example.church" });
  });

  it("400s on a malformed domain before touching the DB", async () => {
    const { client, calls } = makeRequestClient({ data: ROW, error: null });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    for (const bad of ["not a domain", "a.b", "", 42, "example"]) {
      const res = await POST(claimRequest(bad));
      expect(res.status).toBe(400);
    }
    expect(calls.insertCount).toBe(0);
  });

  it("400s on the platform apex and any subdomain of it", async () => {
    const { client, calls } = makeRequestClient({ data: ROW, error: null });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    for (const platform of ["two42.io", "grace.two42.io", "www.grace.two42.io"]) {
      const res = await POST(claimRequest(platform));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/part of the platform/);
    }
    expect(calls.insertCount).toBe(0);
  });

  it("allows a registrable name that merely ends with the apex string", async () => {
    const { client, calls } = makeRequestClient({ data: ROW, error: null });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    const res = await POST(claimRequest("evil-two42.io"));

    expect(res.status).toBe(200);
    expect(calls.insertPayload).toEqual({ domain: "evil-two42.io" });
  });

  it("409s on a duplicate claim (23505)", async () => {
    const { client } = makeRequestClient({ data: null, error: { code: "23505" } });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    const res = await POST(claimRequest("example.church"));

    expect(res.status).toBe(409);
  });

  it("500s on any other insert error", async () => {
    const { client } = makeRequestClient({ data: null, error: { code: "XX000" } });
    requireOrgAdmin.mockResolvedValue({ ok: true, orgId: "org-1", supabase: client });

    const res = await POST(claimRequest("example.church"));

    expect(res.status).toBe(500);
  });

  it("401s / 403s from the gate without reading the body", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 401 });
    expect((await POST(claimRequest("example.church"))).status).toBe(401);
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });
    expect((await POST(claimRequest("example.church"))).status).toBe(403);
  });
});

describe("DOMAIN_SHAPE", () => {
  it.each(["example.church", "www.example.church", "a.bc", "sub.sub.example.org"])(
    "accepts %s",
    (d) => expect(DOMAIN_SHAPE.test(d)).toBe(true),
  );

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
