// Unit test for the approve route's rollback-on-send-failure path (added
// alongside this PR's orgBaseUrl()/resolveEmailBranding() wiring — see
// error-handling review Finding 1). Mirrors
// /api/platform/organizations/[id]/invite-owner's rollback: on a
// sendInviteEmail failure, the access_requests row must go back to
// `pending` with the token nulled out so a retry doesn't 404, rather than
// leaving the row silently `approved` with an unsent token. Mocks
// createClient, sendInviteEmail, orgBaseUrl, and resolveEmailBranding
// directly — same mock-the-collaborator shape as the other route tests in
// this PR.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const sendInviteEmail = vi.fn();
vi.mock("@/lib/email/resend", () => ({
  sendInviteEmail: (...args: unknown[]) => sendInviteEmail(...args),
}));

const orgBaseUrl = vi.fn();
vi.mock("@/lib/org-urls", () => ({
  orgBaseUrl: (...args: unknown[]) => orgBaseUrl(...args),
}));

const resolveEmailBranding = vi.fn();
vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: (...args: unknown[]) => resolveEmailBranding(...args),
}));

const { POST } = await import("@/app/api/admin/approve/route");

function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    single: async () => terminal,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

function makeClient(opts: {
  updatedRow: { org_id: string } | null;
  updateEqSpy?: (col: string, val: unknown) => void;
}) {
  let updateCall = 0;
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } } }),
    },
    from(table: string) {
      if (table === "profiles") {
        return chain({ data: { role: "admin" }, error: null });
      }
      if (table === "access_requests") {
        return {
          update: () => {
            updateCall++;
            // First update() call is the approve write, second (if any) is
            // the rollback — same table, distinguished by call order since
            // both use the same chainable eq()/select() shape.
            if (updateCall === 1) {
              return chain({
                data: opts.updatedRow ? [opts.updatedRow] : [],
                error: null,
              });
            }
            return {
              eq(col: string, val: unknown) {
                opts.updateEqSpy?.(col, val);
                return this;
              },
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve({ data: null, error: null }).then(resolve),
            };
          },
        };
      }
      return chain({ data: null, error: null });
    },
  };
}

function approveRequest(email = "invitee@example.com", name = "Invitee") {
  return new Request("http://localhost/api/admin/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
}

beforeEach(() => {
  createClient.mockReset();
  sendInviteEmail.mockReset();
  orgBaseUrl.mockReset().mockResolvedValue("https://grace.church");
  resolveEmailBranding.mockReset().mockResolvedValue({
    orgName: "Grace Fellowship",
    fromAddress: "noreply@grace.church",
    baseUrl: "https://grace.church",
    accent: "#B85C38",
    accentLight: "#c98a68",
    replyTo: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/approve", () => {
  it("approves and sends the invite using the request's own org", async () => {
    createClient.mockResolvedValue(makeClient({ updatedRow: { org_id: "org-1" } }));
    sendInviteEmail.mockResolvedValue(undefined);

    const res = await POST(approveRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(orgBaseUrl).toHaveBeenCalledWith("org-1");
    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
  });

  it("rolls the request back to pending and returns 500 when the invite email fails to send", async () => {
    const updateEqSpy = vi.fn();
    createClient.mockResolvedValue(
      makeClient({ updatedRow: { org_id: "org-1" }, updateEqSpy })
    );
    sendInviteEmail.mockRejectedValue(new Error("Resend rejected the request"));

    const res = await POST(approveRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to send invite email" });
    // The rollback write must scope by email + the exact token just minted,
    // not touch every pending row for that email.
    expect(updateEqSpy).toHaveBeenCalledWith("email", "invitee@example.com");
    expect(updateEqSpy).toHaveBeenCalledWith("signup_token", expect.any(String));
  });

  it("404s without calling sendInviteEmail when no pending request matches", async () => {
    createClient.mockResolvedValue(makeClient({ updatedRow: null }));

    const res = await POST(approveRequest());

    expect(res.status).toBe(404);
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });
});
