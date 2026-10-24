// The household invitee's request path: the invite row is the org anchor,
// the pending access_requests row it files carries that org and the invite
// token, and an address already pending or approved in that org is a 409.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { POST } = await import("@/app/api/family-invites/request/route");

const TOKEN = "22222222-2222-4222-8222-222222222222";
const INVITE = {
  id: "inv-1",
  org_id: "org-1",
  token: TOKEN,
  invite_email: "Spouse@Example.test",
  accepted_at: null as string | null,
};

function makeClient(opts: {
  invite: typeof INVITE | null;
  existing?: { id: string }[];
  insertSpy?: (payload: unknown) => void;
}) {
  return {
    from(table: string) {
      if (table === "family_invites") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.invite, error: null }),
            }),
          }),
        };
      }
      if (table === "access_requests") {
        return {
          select: () => ({
            eq: () => ({
              ilike: () => ({
                in: () => ({
                  limit: async () => ({ data: opts.existing ?? [], error: null }),
                }),
              }),
            }),
          }),
          insert: async (payload: unknown) => {
            opts.insertSpy?.(payload);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/family-invites/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  createServiceClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/family-invites/request", () => {
  it("files a pending request in the invite's org, for the invited address, carrying the token", async () => {
    const insertSpy = vi.fn();
    createServiceClient.mockResolvedValue(makeClient({ invite: INVITE, insertSpy }));

    const res = await post({ token: TOKEN, name: "Sam", message: "  hi  " });

    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith({
      org_id: "org-1",
      name: "Sam",
      email: "Spouse@Example.test",
      message: "hi",
      invite_token: TOKEN,
      status: "pending",
    });
  });

  it("answers 409 and files nothing when the address is already pending or approved there", async () => {
    const insertSpy = vi.fn();
    createServiceClient.mockResolvedValue(
      makeClient({ invite: INVITE, existing: [{ id: "req-1" }], insertSpy }),
    );

    const res = await post({ token: TOKEN, name: "Sam" });

    expect(res.status).toBe(409);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown or already-claimed invite", async () => {
    createServiceClient.mockResolvedValue(makeClient({ invite: null }));
    expect((await post({ token: TOKEN, name: "Sam" })).status).toBe(404);

    createServiceClient.mockResolvedValue(
      makeClient({ invite: { ...INVITE, accepted_at: "2026-10-01T00:00:00Z" } }),
    );
    expect((await post({ token: TOKEN, name: "Sam" })).status).toBe(404);
  });

  it("rejects a malformed token or a blank name before touching the database", async () => {
    createServiceClient.mockResolvedValue(makeClient({ invite: INVITE }));

    expect((await post({ token: "nope", name: "Sam" })).status).toBe(400);
    expect((await post({ token: TOKEN, name: "   " })).status).toBe(400);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
