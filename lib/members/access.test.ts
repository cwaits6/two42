// Unit tests for the org-admin gate (CWA-40). Every branch here is a
// security decision, and the fail-closed one is what a refactor is most
// likely to invert — turning a transient DB blip into an unauthenticated
// roster export.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { requireOrgAdmin } = await import("@/lib/members/access");

interface StubOptions {
  user?: { id: string } | null;
  authError?: unknown;
  profile?: { role: string; org_id: string } | null;
  profileError?: { code: string; message: string } | null;
}

function stubClient(options: StubOptions) {
  const selected: string[] = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user ?? null },
        error: options.authError ?? null,
      }),
    },
    from: () => ({
      select(columns: string) {
        selected.push(columns);
        return this;
      },
      eq() {
        return this;
      },
      single: async () => ({
        data: options.profile ?? null,
        error: options.profileError ?? null,
      }),
    }),
  };
  createClient.mockResolvedValue(client);
  return { selected };
}

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requireOrgAdmin", () => {
  it("401s when there is no session", async () => {
    stubClient({ user: null });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 401 });
  });

  it("401s AND logs when the auth lookup itself fails", async () => {
    // Without the log, an auth-service outage is indistinguishable from "not
    // signed in": a 401 storm with no recorded cause.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubClient({ user: null, authError: new Error("auth down") });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 401 });
    expect(spy).toHaveBeenCalled();
  });

  it("403s on a profile-query error — 'couldn't tell' must mean 'no'", async () => {
    stubClient({
      user: { id: "u1" },
      profileError: { code: "57014", message: "statement timeout" },
    });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 403 });
  });

  it("logs only code and message on that error, never details or hint", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubClient({
      user: { id: "u1" },
      profileError: {
        code: "42501",
        message: "permission denied",
        // @ts-expect-error — the driver carries these; the gate must not log them.
        details: "Key (email)=(ada@example.com)",
      },
    });
    await requireOrgAdmin();
    expect(spy.mock.calls[0].join(" ")).not.toContain("ada@example.com");
  });

  it("403s for a member", async () => {
    stubClient({ user: { id: "u1" }, profile: { role: "member", org_id: "o1" } });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 403 });
  });

  it("403s for a content_editor — the closest role to admin", async () => {
    stubClient({
      user: { id: "u1" },
      profile: { role: "content_editor", org_id: "o1" },
    });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 403 });
  });

  it("403s for pending", async () => {
    stubClient({ user: { id: "u1" }, profile: { role: "pending", org_id: "o1" } });
    expect(await requireOrgAdmin()).toEqual({ ok: false, status: 403 });
  });

  it("returns the caller's org_id for an admin", async () => {
    // The org anchor callers thread into loadOrgSnapshot/applyWrites. It must
    // come off the caller's own RLS-scoped profile row, never a request body.
    const { selected } = stubClient({
      user: { id: "u1" },
      profile: { role: "admin", org_id: "org-42" },
    });
    const gate = await requireOrgAdmin();
    expect(gate.ok).toBe(true);
    expect(gate.ok && gate.orgId).toBe("org-42");
    expect(gate.ok && gate.user.id).toBe("u1");
    expect(selected[0]).toContain("org_id");
  });
});
