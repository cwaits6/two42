// Unit tests for inviting one person. The writes run on the service client,
// so the org predicate on every chain is the tenant boundary and is asserted
// directly; the responses are asserted for what the form shows under each
// field, which must never be a database or provider message.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServiceClient } from "@/lib/members/inviteTestHelpers";

const ORG = "org-1";

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

const { POST } = await import("@/app/api/admin/members/invite/route");

function inviteRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/admin/members/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const person = { email: "Ana@Example.com ", firstName: "Ana", lastName: "Okafor" };

beforeEach(() => {
  requireOrgAdmin.mockReset().mockResolvedValue({
    ok: true,
    user: { id: "admin-1" },
    orgId: ORG,
  });
  createServiceClient.mockReset();
  send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/admin/members/invite", () => {
  it("creates an approved request in the admin's org and mails its setup link", async () => {
    const fake = fakeServiceClient();
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(inviteRequest(person));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });

    const insert = fake.calls.find(
      (c) => c.table === "access_requests" && c.op === "insert"
    );
    expect(insert?.payload).toMatchObject({
      org_id: ORG,
      email: "ana@example.com",
      name: "Ana Okafor",
      status: "approved",
      reviewed_by: "admin-1",
      invite_token: null,
    });
    for (const lookup of fake.calls.filter((c) => c.op === "select")) {
      expect(lookup.filters).toContainEqual(["eq", "org_id", ORG]);
    }

    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("ana@example.com");
    expect(mail.html).toContain(
      `https://two42.io/setup-account?token=${insert?.payload?.signup_token}`
    );
  });

  it("lists the person in the chosen household and links the request to it", async () => {
    const fake = fakeServiceClient();
    createServiceClient.mockResolvedValue(fake.client);
    const householdId = "6f1c2b9e-3a4d-4c5e-8f60-718293a4b5c6";

    const res = await POST(inviteRequest({ ...person, householdId }));

    expect(res.status).toBe(200);
    const inserts = fake.calls.filter((c) => c.op === "insert");
    expect(inserts.map((c) => c.table)).toEqual([
      "family_members",
      "family_invites",
      "access_requests",
    ]);
    for (const insert of inserts) expect(insert.payload?.org_id).toBe(ORG);
    expect(inserts[0].payload).toMatchObject({
      family_id: householdId,
      first_name: "Ana",
      last_name: "Okafor",
    });
    expect(inserts[1].payload).toMatchObject({
      family_id: householdId,
      family_member_id: "family_members-1",
      invite_email: "ana@example.com",
    });
    expect(inserts[2].payload?.invite_token).toBe("family_invites-token");
  });

  it("reports an email that already has an account and sends nothing", async () => {
    const fake = fakeServiceClient({
      existing: { profiles: [{ email: "ana@example.com" }] },
    });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(inviteRequest(person));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      fieldErrors: { email: "This email already has an account. No invite was sent." },
    });
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports an email that already has an invite and sends nothing", async () => {
    const fake = fakeServiceClient({
      existing: { access_requests: [{ email: "ana@example.com" }] },
    });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(inviteRequest(person));

    expect(res.status).toBe(409);
    expect((await res.json()).fieldErrors.email).toMatch(/already has an invite/);
    expect(send).not.toHaveBeenCalled();
  });

  it("matches an earlier request whose email was typed in another case", async () => {
    const fake = fakeServiceClient({
      existing: { access_requests: [{ email: "Ana_O@Example.COM" }] },
    });
    createServiceClient.mockResolvedValue(fake.client);

    const res = await POST(inviteRequest({ ...person, email: "ana_o@example.com" }));

    expect(res.status).toBe(409);
    const lookup = fake.calls.find(
      (c) => c.table === "access_requests" && c.op === "select"
    );
    expect(lookup?.filters).toContainEqual([
      "ilikeAnyOf",
      "email",
      ['"ana\\\\_o@example.com"'],
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports every invalid field before touching the database", async () => {
    const res = await POST(
      inviteRequest({ email: "ana@", firstName: " ", lastName: "", householdId: "x" })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      fieldErrors: {
        email: "Enter an email address like name@example.com.",
        firstName: "Enter a first name.",
        lastName: "Enter a last name.",
        householdId: "Choose a household from the list.",
      },
    });
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("deletes everything it wrote when the email fails, and shows no provider text", async () => {
    const fake = fakeServiceClient();
    createServiceClient.mockResolvedValue(fake.client);
    send.mockResolvedValue({ data: null, error: { message: "Resend: domain not verified" } });
    const householdId = "6f1c2b9e-3a4d-4c5e-8f60-718293a4b5c6";

    const res = await POST(inviteRequest({ ...person, householdId }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Couldn't send the invite. Try again." });
    const deletes = fake.calls.filter((c) => c.op === "delete");
    expect(deletes.map((c) => c.table)).toEqual([
      "access_requests",
      "family_invites",
      "family_members",
    ]);
    for (const del of deletes) expect(del.filters).toContainEqual(["eq", "org_id", ORG]);
  });

  it("refuses a caller who is not a church admin", async () => {
    requireOrgAdmin.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(inviteRequest(person));

    expect(res.status).toBe(403);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
