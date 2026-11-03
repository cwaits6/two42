// A child without an account can't be invited, and the refusal comes before any
// invite is read, written or emailed. The database repeats the rule for a direct
// write, which reaches this route as HP002 when a row changes under it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
const sendFamilyInviteEmail = vi.fn(async () => undefined);
vi.mock("@/lib/email/resend", () => ({
  sendFamilyInviteEmail: (...args: unknown[]) => (sendFamilyInviteEmail as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: async () => ({}),
}));

const { POST } = await import("@/app/api/family-invites/route");
const { CHILD_INVITE_REFUSED } = await import("@/lib/household");

function makeClient(opts: {
  member: { relationship: string; claimed_profile_id: string | null };
  insertError?: { code: string } | null;
  existingInvite?: { id: string } | null;
}) {
  const insert = vi.fn(() => ({
    select: () => ({
      single: async () =>
        opts.insertError
          ? { data: null, error: opts.insertError }
          : { data: { token: "tok", org_id: "org-1" }, error: null },
    }),
  }));
  const inviteLookup = vi.fn(async () => ({ data: opts.existingInvite ?? null, error: null }));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { role: "member", family_id: "f1", first_name: "Henry", last_name: "M", preferred_name: null },
              }),
            }),
          }),
        };
      }
      if (table === "family_members") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: "m1", family_id: "f1", first_name: "Jack", last_name: "M", ...opts.member },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "family_invites") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({ order: () => ({ limit: () => ({ maybeSingle: inviteLookup }) }) }),
            }),
          }),
          insert,
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client, insert, inviteLookup };
}

function post() {
  return POST(
    new Request("http://localhost/api/family-invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_member_id: "m1", invite_email: "kid@example.test" }),
    }),
  );
}

describe("POST /api/family-invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("refuses a child without an account, with no insert or email", async () => {
    const { client, insert, inviteLookup } = makeClient({
      member: { relationship: "child", claimed_profile_id: null },
      existingInvite: { id: "inv-1" },
    });
    createClient.mockResolvedValue(client);

    const res = await post();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CHILD_INVITE_REFUSED });
    expect(inviteLookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(sendFamilyInviteEmail).not.toHaveBeenCalled();
  });

  it("gives the same refusal when the database raises it on the insert", async () => {
    const { client } = makeClient({
      member: { relationship: "other", claimed_profile_id: null },
      insertError: { code: "HP002" },
    });
    createClient.mockResolvedValue(client);

    const res = await post();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: CHILD_INVITE_REFUSED });
    expect(sendFamilyInviteEmail).not.toHaveBeenCalled();
  });

  it("still fails other insert errors as a server error", async () => {
    const { client } = makeClient({
      member: { relationship: "other", claimed_profile_id: null },
      insertError: { code: "23505" },
    });
    createClient.mockResolvedValue(client);

    expect((await post()).status).toBe(500);
  });

  it("invites an adult household member", async () => {
    const { client, insert } = makeClient({ member: { relationship: "other", claimed_profile_id: null } });
    createClient.mockResolvedValue(client);

    const res = await post();

    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(sendFamilyInviteEmail).toHaveBeenCalledTimes(1);
  });

  it("answers 409 for a child who already has an account", async () => {
    const { client, insert } = makeClient({ member: { relationship: "child", claimed_profile_id: "p1" } });
    createClient.mockResolvedValue(client);

    expect((await post()).status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });
});
