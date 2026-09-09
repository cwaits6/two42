// Unit test for the orgBaseUrl() anchor in the bulk-invite route (Phase 5 PR
// 5 / CWA-69). This is the highest-risk of the five routes the PR's own
// review flagged as newly threading a validated org_id into orgBaseUrl():
// it resolves the CALLER's own profile.org_id rather than a target entity's,
// so a variable mix-up (e.g. reading a different row's id) is easy to
// introduce silently and would not fail guard:tenancy or any existing test.
// Mocks createClient and @/lib/org-urls directly; the Resend SDK is mocked
// the same way app/api/admin/email-domain/route.test.ts mocks it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const orgBaseUrl = vi.fn();
vi.mock("@/lib/org-urls", () => ({
  orgBaseUrl: (...args: unknown[]) => orgBaseUrl(...args),
}));

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => send(...args) };
  },
}));

const { POST } = await import("@/app/api/admin/invite-bulk/route");

function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: async () => terminal,
    single: async () => terminal,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

function makeClient(opts: { profileOrgId: string; insertError?: unknown }) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } } }),
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          // The admin-lookup select ("role, org_id") returns a single row;
          // the existing-members select ("email") returns an array — same
          // table, two different result shapes, distinguished by the
          // requested columns the way PostgREST actually would be.
          select: (cols: string) =>
            cols.includes("org_id")
              ? chain({ data: { role: "admin", org_id: opts.profileOrgId }, error: null })
              : chain({ data: [], error: null }),
        };
      }
      if (table === "access_requests") {
        return {
          select: () => chain({ data: [], error: null }),
          insert: () => chain({ data: null, error: opts.insertError ?? null }),
          delete: () => chain({ data: null, error: null }),
        };
      }
      return chain({ data: null, error: null });
    },
  };
}

function bulkRequest(emails: string[]) {
  return new Request("http://localhost/api/admin/invite-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails }),
  });
}

beforeEach(() => {
  createClient.mockReset();
  orgBaseUrl.mockReset().mockResolvedValue("https://grace.church");
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("POST /api/admin/invite-bulk", () => {
  it("resolves orgBaseUrl from the admin's own profile.org_id, not a target row's id", async () => {
    createClient.mockResolvedValue(makeClient({ profileOrgId: "org-1" }));

    const res = await POST(bulkRequest(["new-member@example.com"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, errors: [] });
    expect(orgBaseUrl).toHaveBeenCalledWith("org-1");
    expect(orgBaseUrl).toHaveBeenCalledTimes(1);
    // The signup link mailed out is built from the resolved org origin, not
    // the deployment's env-pinned platform URL.
    const sentHtml = send.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("https://grace.church/join?token=");
  });

  it("uses a different admin's own org, not a hardcoded/default id", async () => {
    createClient.mockResolvedValue(makeClient({ profileOrgId: "org-2" }));

    await POST(bulkRequest(["another@example.com"]));

    expect(orgBaseUrl).toHaveBeenCalledWith("org-2");
  });
});
