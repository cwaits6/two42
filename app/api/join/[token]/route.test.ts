// The new-person path of a group invite: the route mints the signup token,
// hands it to group_invite_redeem(), reserves quota, mails the link, and
// clears the token on (id, org_id) when the mail never left. Mocks the
// service client, the sender, the branding and the quota directly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const sendGroupInviteEmail = vi.fn();
vi.mock("@/lib/email/resend", () => ({
  sendGroupInviteEmail: (...args: unknown[]) => sendGroupInviteEmail(...args),
}));

const resolveEmailBranding = vi.fn();
vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: (...args: unknown[]) => resolveEmailBranding(...args),
}));

const reserveEmailQuota = vi.fn();
vi.mock("@/lib/email/quota", () => ({
  reserveEmailQuota: (...args: unknown[]) => reserveEmailQuota(...args),
}));

const { POST } = await import("@/app/api/join/[token]/route");

const TOKEN = "11111111-1111-4111-8111-111111111111";
const ROW = {
  org_id: "org-1",
  group_id: "group-1",
  group_name: "Tuesday Table",
  access_request_id: "req-1",
};

function makeClient(opts: {
  rpc: { data: unknown; error: { code: string; message: string } | null };
  updateEqSpy?: (col: string, val: unknown) => void;
}) {
  const rpc = vi.fn(async () => opts.rpc);
  return {
    client: {
      rpc,
      from(table: string) {
        if (table !== "access_requests") throw new Error(`unexpected table ${table}`);
        return {
          update: () => ({
            eq(col: string, val: unknown) {
              opts.updateEqSpy?.(col, val);
              return this;
            },
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          }),
        };
      },
    },
    rpc,
  };
}

function post(body: unknown, token = TOKEN) {
  return POST(
    new Request(`http://localhost/api/join/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  createServiceClient.mockReset();
  sendGroupInviteEmail.mockReset().mockResolvedValue(undefined);
  reserveEmailQuota.mockReset().mockResolvedValue(true);
  resolveEmailBranding.mockReset().mockResolvedValue({
    orgName: "Grace Fellowship",
    fromAddress: "noreply@grace.church",
    baseUrl: "https://grace.church",
    accent: "#B85C38",
    replyTo: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/join/[token]", () => {
  it("redeems, reserves quota for the invite's org and mails the minted token", async () => {
    const { client, rpc } = makeClient({ rpc: { data: [ROW], error: null } });
    createServiceClient.mockResolvedValue(client);

    const res = await post({ name: "Ada", email: "ada@example.test" });

    expect(res.status).toBe(200);
    const args = rpc.mock.calls[0] as unknown as [string, Record<string, string>];
    expect(args[0]).toBe("group_invite_redeem");
    expect(args[1]._token).toBe(TOKEN);
    expect(args[1]._signup_token).toMatch(/^[0-9a-f]{64}$/);
    expect(reserveEmailQuota).toHaveBeenCalledWith("org-1", 1);
    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
    expect(sendGroupInviteEmail).toHaveBeenCalledTimes(1);
    const [to, name, groupName, link] = sendGroupInviteEmail.mock.calls[0];
    expect(to).toBe("ada@example.test");
    expect(name).toBe("Ada");
    expect(groupName).toBe("Tuesday Table");
    expect(link).toContain(`/setup-account?token=${args[1]._signup_token}`);
  });

  it("answers a dead link with the one generic 404 and sends nothing", async () => {
    const { client } = makeClient({ rpc: { data: null, error: { code: "GI001", message: "dead" } } });
    createServiceClient.mockResolvedValue(client);

    const res = await post({ name: "Ada", email: "ada@example.test" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "This link isn't valid anymore. Ask a leader of the group for a new one.",
    });
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
    expect(reserveEmailQuota).not.toHaveBeenCalled();
  });

  it("answers an address that cannot sign up with 409 whichever code the RPC raised", async () => {
    for (const code of ["GI003", "GI004", "GI006"]) {
      const { client } = makeClient({ rpc: { data: null, error: { code, message: code } } });
      createServiceClient.mockResolvedValue(client);
      const res = await post({ name: "Ada", email: "ada@example.test" });
      expect(res.status, code).toBe(409);
    }
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
  });

  it("rejects a malformed token or body before touching the database", async () => {
    createServiceClient.mockResolvedValue(makeClient({ rpc: { data: [ROW], error: null } }).client);

    expect((await post({ name: "Ada", email: "ada@example.test" }, "not-a-uuid")).status).toBe(404);
    expect((await post({ name: "", email: "ada@example.test" })).status).toBe(400);
    expect((await post({ name: "Ada", email: "not-an-email" })).status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("clears the token on (id, org_id) and returns 500 when the email fails to send", async () => {
    const updateEqSpy = vi.fn();
    const { client } = makeClient({ rpc: { data: [ROW], error: null }, updateEqSpy });
    createServiceClient.mockResolvedValue(client);
    sendGroupInviteEmail.mockRejectedValue(new Error("Resend rejected the request"));

    const res = await post({ name: "Ada", email: "ada@example.test" });

    expect(res.status).toBe(500);
    expect(updateEqSpy).toHaveBeenCalledWith("id", "req-1");
    expect(updateEqSpy).toHaveBeenCalledWith("org_id", "org-1");
  });

  it("clears the token and returns 503 without sending when the org's quota refuses", async () => {
    const updateEqSpy = vi.fn();
    const { client } = makeClient({ rpc: { data: [ROW], error: null }, updateEqSpy });
    createServiceClient.mockResolvedValue(client);
    reserveEmailQuota.mockResolvedValue(false);

    const res = await post({ name: "Ada", email: "ada@example.test" });

    expect(res.status).toBe(503);
    expect(sendGroupInviteEmail).not.toHaveBeenCalled();
    expect(updateEqSpy).toHaveBeenCalledWith("id", "req-1");
    expect(updateEqSpy).toHaveBeenCalledWith("org_id", "org-1");
  });
});
