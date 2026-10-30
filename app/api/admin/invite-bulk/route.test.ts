// Unit test for the signup link the bulk-invite route mails out: it must
// land on the app's one canonical origin, whichever org the admin belongs
// to, and the invite rows must carry that admin's org.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServiceClient } from "@/lib/members/inviteTestHelpers";

const requireOrgAdmin = vi.fn();
vi.mock("@/lib/members/access", () => ({
  requireOrgAdmin: () => requireOrgAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { siteConfig: { ...actual.siteConfig, url: "https://two42.io" } };
});

vi.mock("@/lib/email/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/identity")>();
  return {
    ...actual,
    resolveEmailBranding: async () => ({
      orgName: "Grace Church",
      replyTo: null,
      accent: "#b5562f",
      accentLight: "#d98b6a",
      fromAddress: "noreply@two42.io",
      baseUrl: "https://two42.io",
    }),
  };
});

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => send(...args) };
  },
}));

const { POST } = await import("@/app/api/admin/invite-bulk/route");

function bulkRequest(emails: string[]) {
  return new Request("http://localhost/api/admin/invite-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails }),
  });
}

beforeEach(() => {
  requireOrgAdmin.mockReset().mockResolvedValue({
    ok: true,
    user: { id: "admin-1" },
    orgId: "org-1",
  });
  createServiceClient.mockReset();
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("POST /api/admin/invite-bulk", () => {
  it("mails a signup link on the canonical origin", async () => {
    const fake = fakeServiceClient();
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(bulkRequest(["new-member@example.com"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 0, errors: [] });
    const sentHtml = send.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("https://two42.io/setup-account?token=");
    const insert = fake.calls.find((c) => c.op === "insert");
    expect(insert?.table).toBe("access_requests");
    expect(insert?.payload?.org_id).toBe("org-1");
  });

  it("skips members and earlier invites, and reports a failed send without its provider text", async () => {
    const fake = fakeServiceClient({
      existing: {
        profiles: [{ email: "member@example.com" }],
        access_requests: [{ email: "invited@example.com" }],
      },
    });
    createServiceClient.mockResolvedValue(fake.client);
    send.mockResolvedValue({ data: null, error: { message: "Resend: rate limited" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      bulkRequest(["Member@example.com", "invited@example.com", "new@example.com"])
    );

    expect(await res.json()).toEqual({
      sent: 0,
      skipped: 2,
      errors: ["new@example.com: the invite couldn't be sent"],
    });
  });
});
