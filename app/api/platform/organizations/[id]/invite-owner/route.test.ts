// Send invite on the church page. The mailer is mocked; the service client's
// org filters are asserted because they are the tenant boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFirstAdminService } from "../../firstAdminInviteTestHelpers";

const requirePlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  requirePlatformAdmin: () => requirePlatformAdmin(),
}));

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const reserveEmailQuota = vi.fn();
vi.mock("@/lib/email/quota", () => ({
  reserveEmailQuota: (...args: unknown[]) => reserveEmailQuota(...args),
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
      orgName: "Hillside Church",
      replyTo: null,
      accent: "#b5562f",
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

const { POST } = await import("./route");

const ORG = "org-1";

function sendInvite(ownerEmail: string) {
  return POST(
    new Request(`http://localhost/api/platform/organizations/${ORG}/invite-owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEmail }),
    }),
    { params: Promise.resolve({ id: ORG }) },
  );
}

beforeEach(() => {
  requirePlatformAdmin.mockReset().mockResolvedValue({ ok: true, user: { id: "operator-1" } });
  createServiceClient.mockReset();
  reserveEmailQuota.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/platform/organizations/[id]/invite-owner", () => {
  it("sends the member invite, scoped to the church in the route", async () => {
    const fake = fakeFirstAdminService({ rows: [{ id: "ar-1", email: "admin@hillside.example" }] });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe("You're invited to join Hillside Church");
    for (const call of fake.calls) expect(call.filters).toContainEqual(["org_id", ORG]);
    expect(reserveEmailQuota).toHaveBeenCalledWith(ORG, 1);
  });

  it("finds a first admin whose email was saved in mixed case", async () => {
    const fake = fakeFirstAdminService({ rows: [{ id: "ar-1", email: "Admin@Hillside.example" }] });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(200);
    expect(send.mock.calls[0][0].to).toBe("admin@hillside.example");
  });

  it("answers 404 for a first admin request a church admin denied, and approves nothing", async () => {
    const fake = fakeFirstAdminService({
      rows: [{ id: "ar-1", email: "admin@hillside.example", status: "denied" }],
    });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(404);
    expect(fake.calls.filter((c) => c.op === "update")).toEqual([]);
    expect(reserveEmailQuota).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("answers 404 when the church's first admin has another email", async () => {
    const fake = fakeFirstAdminService({ rows: [{ id: "ar-1", email: "someone@else.example" }] });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(404);
    expect(reserveEmailQuota).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses without claiming the limit was reached, since a failed quota check answers the same", async () => {
    const fake = fakeFirstAdminService({ rows: [{ id: "ar-1", email: "admin@hillside.example" }] });
    createServiceClient.mockResolvedValue(fake.client);
    reserveEmailQuota.mockResolvedValue(false);

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "The invite wasn't sent. This organization may have reached today's email limit. Try again later, or raise the limit on this page.",
    );
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rolls the token back and answers 500 when the send fails", async () => {
    const fake = fakeFirstAdminService({ rows: [{ id: "ar-1", email: "admin@hillside.example" }] });
    createServiceClient.mockResolvedValue(fake.client);
    send.mockResolvedValue({ data: null, error: { message: "provider down" } });

    const res = await sendInvite("admin@hillside.example");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't send the invite. Try again." });
    const updates = fake.calls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ signup_token: null, token_expires_at: null });
  });

  it("does not report a send when the token update wrote nothing", async () => {
    const fake = fakeFirstAdminService({
      rows: [{ id: "ar-1", email: "admin@hillside.example" }],
      updated: 0,
    });
    createServiceClient.mockResolvedValue(fake.client);

    expect((await sendInvite("admin@hillside.example")).status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });
});
