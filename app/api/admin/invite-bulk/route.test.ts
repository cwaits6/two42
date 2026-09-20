// Unit test for the signup link the bulk-invite route mails out: it must
// land on the app's one canonical origin, whichever org the admin belongs
// to. Mocks createClient directly; the Resend SDK is mocked the same way
// app/api/admin/email-domain/route.test.ts mocks it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { siteConfig: { ...actual.siteConfig, url: "https://two42.io" } };
});

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

function makeClient(opts: { insertError?: unknown } = {}) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } } }),
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          // The admin-lookup select ("role") returns a single row; the
          // existing-members select ("email") returns an array — same
          // table, two different result shapes, distinguished by the
          // requested columns the way PostgREST actually would be.
          select: (cols: string) =>
            cols.includes("role")
              ? chain({ data: { role: "admin" }, error: null })
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
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("POST /api/admin/invite-bulk", () => {
  it("mails a signup link on the canonical origin", async () => {
    createClient.mockResolvedValue(makeClient());

    const res = await POST(bulkRequest(["new-member@example.com"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, errors: [] });
    const sentHtml = send.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("https://two42.io/setup-account?token=");
  });
});
