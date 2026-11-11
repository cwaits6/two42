// Adding a church sends its first admin one invite. The mailer is mocked;
// the service client's org filters are asserted because they are the tenant
// boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFirstAdminService } from "./firstAdminInviteTestHelpers";

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

const ORG = "org-new";
const ADMIN_ROW = { id: "ar-1", email: "admin@hillside.example" };

function addRequest(ownerEmail: string) {
  return new Request("http://localhost/api/platform/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Hillside Church", ownerEmail }),
  });
}

beforeEach(() => {
  requirePlatformAdmin.mockReset().mockResolvedValue({ ok: true, user: { id: "operator-1" } });
  createServiceClient.mockReset();
  reserveEmailQuota.mockReset().mockResolvedValue(true);
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/platform/organizations", () => {
  it("saves the first admin's email lowercased and sends them one invite", async () => {
    const fake = fakeFirstAdminService({ rows: [ADMIN_ROW] });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(addRequest(" Admin@Hillside.EXAMPLE "));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, orgId: ORG, inviteSent: true });
    expect(fake.calls[0]).toMatchObject({
      op: "rpc",
      payload: { _name: "Hillside Church", _owner_email: "admin@hillside.example" },
    });
    for (const call of fake.calls.filter((c) => c.table === "access_requests")) {
      expect(call.filters).toContainEqual(["org_id", ORG]);
    }
    expect(reserveEmailQuota).toHaveBeenCalledWith(ORG, 1);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("admin@hillside.example");
    expect(mail.subject).toBe("You're invited to join Hillside Church");
    const update = fake.calls.find((c) => c.op === "update");
    expect(mail.html).toContain(
      `https://two42.io/setup-account?token=${update?.payload?.signup_token}`,
    );
  });

  it("mints a setup link that expires seven days after it is sent", async () => {
    const now = new Date("2026-11-11T15:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const fake = fakeFirstAdminService({ rows: [ADMIN_ROW] });
    createServiceClient.mockResolvedValue(fake.client);

    await POST(addRequest("admin@hillside.example"));

    const [mint] = fake.calls.filter((c) => c.op === "update");
    expect(mint.payload).toEqual({
      status: "approved",
      reviewed_by: "operator-1",
      reviewed_at: now.toISOString(),
      signup_token: expect.stringMatching(/^[0-9a-f]{64}$/),
      token_expires_at: "2026-11-18T15:00:00.000Z",
    });
    expect(mint.filters).toEqual([
      ["id", ADMIN_ROW.id],
      ["org_id", ORG],
    ]);
  });

  it("sends nothing the second time the same church or first admin is added", async () => {
    let added = false;
    const fake = fakeFirstAdminService({
      rows: [ADMIN_ROW],
      rpc: () => {
        if (added) return { data: null, error: { code: "TN005" } };
        added = true;
        return { data: ORG, error: null };
      },
    });
    createServiceClient.mockResolvedValue(fake.client);

    expect((await POST(addRequest("admin@hillside.example"))).status).toBe(200);
    const again = await POST(addRequest("admin@hillside.example"));

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: "That email already has an invite or an approved request in another organization.",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("adds the church and says the invite wasn't sent when the send fails", async () => {
    const fake = fakeFirstAdminService({ rows: [ADMIN_ROW] });
    createServiceClient.mockResolvedValue(fake.client);
    send.mockResolvedValue({ data: null, error: { message: "provider down" } });

    const res = await POST(addRequest("admin@hillside.example"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, orgId: ORG, inviteSent: false });
    const [mint, rollback] = fake.calls.filter((c) => c.op === "update");
    expect(rollback.payload).toEqual({ signup_token: null, token_expires_at: null });
    expect(rollback.filters).toContainEqual(["org_id", ORG]);
    expect(rollback.filters).toContainEqual(["signup_token", mint.payload?.signup_token]);
  });

  it("mints no token and sends nothing when the church is at its email limit", async () => {
    const fake = fakeFirstAdminService({ rows: [ADMIN_ROW] });
    createServiceClient.mockResolvedValue(fake.client);
    reserveEmailQuota.mockResolvedValue(false);

    const res = await POST(addRequest("admin@hillside.example"));

    expect(await res.json()).toEqual({ success: true, orgId: ORG, inviteSent: false });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a malformed email before adding anything", async () => {
    const res = await POST(addRequest("admin@"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter an email address like name@example.com." });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
