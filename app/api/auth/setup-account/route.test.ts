// The server half of account setup: the token row decides the email, name
// and org; the account is created confirmed under the link's derived id; the
// household is linked and the link consumed; and every partial failure leaves
// a link that a retry can finish. Mocks the service client and the logger.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupUserId } from "../setup-link";
import { SETUP_STATUS } from "../setup-response";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const logError = vi.fn();
const logWarn = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => logError(...args),
  logWarn: (...args: unknown[]) => logWarn(...args),
}));

const { POST } = await import("./route");

const TOKEN = "a".repeat(64);
const PASSWORD = "correct horse battery";
const USER_ID = setupUserId(TOKEN);
const ORG = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const INVITE = "44444444-4444-4444-8444-444444444444";
const INVITE_TOKEN = "55555555-5555-4555-8555-555555555555";

type Row = {
  id: string;
  org_id: string | null;
  name: string;
  email: string;
  token_expires_at: string | null;
  invite_token: string | null;
  group_id: string | null;
};

const BASE_ROW: Row = {
  id: REQUEST,
  org_id: ORG,
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  invite_token: null,
  group_id: null,
};

type Call = {
  table: string;
  op: "select" | "update";
  payload?: unknown;
  eqs: [string, unknown][];
  ors?: string[];
};
type Result = { data: unknown; error: unknown };
type AuthError = { status?: number; code?: string; message: string };

const USER_NOT_FOUND: AuthError = { status: 404, code: "user_not_found", message: "User not found" };

function fakeService(opts: {
  row?: Row | null;
  lookupError?: unknown;
  invite?: Record<string, unknown> | null;
  member?: Record<string, unknown> | null;
  respond?: (call: Call) => Result | undefined;
  users?: Map<string, { email: string }>;
  createError?: AuthError;
  getUserError?: AuthError;
}) {
  const calls: Call[] = [];
  const users = opts.users ?? new Map<string, { email: string }>();
  const respond = (call: Call): Result => {
    const custom = opts.respond?.(call);
    if (custom) return custom;
    if (call.table === "access_requests" && call.op === "select") {
      return { data: opts.row === undefined ? BASE_ROW : opts.row, error: opts.lookupError ?? null };
    }
    if (call.table === "family_invites" && call.op === "select") {
      return { data: opts.invite ?? null, error: null };
    }
    if (call.table === "family_members" && call.op === "select") {
      const member = opts.member === undefined ? { id: "member-1", family_id: opts.invite?.family_id } : opts.member;
      return { data: member, error: null };
    }
    return { data: [{ id: "x" }], error: null };
  };

  const admin = {
    getUserById: vi.fn(async (id: string) => {
      if (opts.getUserError) return { data: { user: null }, error: opts.getUserError };
      const user = users.get(id);
      return user
        ? { data: { user: { id, email: user.email } }, error: null }
        : { data: { user: null }, error: USER_NOT_FOUND };
    }),
    createUser: vi.fn(async (attrs: { id: string; email: string; app_metadata?: unknown }) => {
      if (opts.createError) return { data: { user: null }, error: opts.createError };
      users.set(attrs.id, { email: attrs.email.toLowerCase() });
      return { data: { user: { id: attrs.id } }, error: null };
    }),
    updateUserById: vi.fn(async () => ({ data: { user: {} }, error: null })),
  };

  const client = {
    auth: { admin },
    from(table: string) {
      const call: Call = { table, op: "select", eqs: [] };
      const builder = {
        select() {
          return builder;
        },
        update(payload: unknown) {
          call.op = "update";
          call.payload = payload;
          return builder;
        },
        eq(col: string, val: unknown) {
          call.eqs.push([col, val]);
          return builder;
        },
        or(filter: string) {
          (call.ors ??= []).push(filter);
          return builder;
        },
        maybeSingle() {
          calls.push(call);
          return Promise.resolve(respond(call));
        },
        then(resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) {
          calls.push(call);
          return Promise.resolve(respond(call)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  createServiceClient.mockResolvedValue(client);
  return { calls, admin, users };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/auth/setup-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const consumeCalls = (calls: Call[]) =>
  calls.filter((c) => c.table === "access_requests" && c.op === "update");
const householdWrites = (calls: Call[]) =>
  calls.filter((c) => c.op === "update" && c.table !== "access_requests");

beforeEach(() => {
  createServiceClient.mockReset();
  logError.mockReset();
  logWarn.mockReset();
});

describe("POST /api/auth/setup-account — each invite kind", () => {
  it("creates a confirmed account from a church admin approval and consumes the link", async () => {
    const { calls, admin } = fakeService({});
    const res = await post({ token: TOKEN, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/dashboard" });
    expect(admin.createUser).toHaveBeenCalledWith({
      id: USER_ID,
      email: BASE_ROW.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: BASE_ROW.name },
      app_metadata: { org_id: ORG },
    });
    const lookup = calls[0];
    expect(lookup.eqs).toEqual([
      ["signup_token", TOKEN],
      ["status", "approved"],
    ]);
    const [consume] = consumeCalls(calls);
    expect(consume.payload).toEqual({ signup_token: null });
    expect(consume.eqs).toEqual([
      ["id", REQUEST],
      ["org_id", ORG],
      ["signup_token", TOKEN],
    ]);
    expect(householdWrites(calls)).toEqual([]);
  });

  it("lands a group invite in its group", async () => {
    fakeService({ row: { ...BASE_ROW, group_id: GROUP } });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(await res.json()).toEqual({ redirect: `/g/${GROUP}/dashboard` });
  });

  it.each([
    ["a member invite with a household"],
    ["a household invite approved through a request"],
  ])("links the household for %s, every write on the row's org", async () => {
    const { calls } = fakeService({
      row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
      invite: {
        id: INVITE,
        family_id: "family-1",
        family_member_id: "member-1",
        invite_email: "ada@example.com",
        accepted_at: null,
      },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });

    expect(res.status).toBe(200);
    const inviteLookup = calls.find((c) => c.table === "family_invites" && c.op === "select")!;
    expect(inviteLookup.eqs).toEqual([
      ["token", INVITE_TOKEN],
      ["org_id", ORG],
    ]);
    const writes = householdWrites(calls);
    expect(writes.map((c) => c.table)).toEqual(["profiles", "family_members", "family_invites"]);
    expect(writes[0].payload).toEqual({ family_id: "family-1" });
    expect(writes[0].eqs).toEqual([
      ["id", USER_ID],
      ["org_id", ORG],
    ]);
    expect(writes[1].payload).toEqual({ claimed_profile_id: USER_ID });
    expect(writes[1].eqs).toEqual([
      ["id", "member-1"],
      ["org_id", ORG],
      ["family_id", "family-1"],
    ]);
    expect(writes[1].ors).toEqual([`claimed_profile_id.is.null,claimed_profile_id.eq.${USER_ID}`]);
    expect(writes[2].payload).toEqual({ accepted_at: expect.any(String) });
    expect(writes[2].eqs).toEqual([
      ["id", INVITE],
      ["org_id", ORG],
    ]);
    // The link is consumed only after the household is linked.
    expect(calls.indexOf(consumeCalls(calls)[0])).toBeGreaterThan(calls.indexOf(writes[0]));
  });

  it("skips an invite for another address and still finishes setup", async () => {
    const { calls } = fakeService({
      row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
      invite: {
        id: INVITE,
        family_id: "family-1",
        family_member_id: "member-1",
        invite_email: "someone-else@example.com",
        accepted_at: null,
      },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(householdWrites(calls)).toEqual([]);
    expect(consumeCalls(calls)).toHaveLength(1);
  });

  it("skips an invite whose member has moved to another household", async () => {
    const { calls } = fakeService({
      row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
      invite: {
        id: INVITE,
        family_id: "family-1",
        family_member_id: "member-1",
        invite_email: "ada@example.com",
        accepted_at: null,
      },
      member: { id: "member-1", family_id: "family-2" },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
    const memberLookup = calls.find((c) => c.table === "family_members" && c.op === "select")!;
    expect(memberLookup.eqs).toEqual([
      ["id", "member-1"],
      ["org_id", ORG],
    ]);
    expect(householdWrites(calls)).toEqual([]);
    expect(consumeCalls(calls)).toHaveLength(1);
  });

  it("ignores an email or org in the body", async () => {
    const { calls, admin } = fakeService({});
    await post({ token: TOKEN, password: PASSWORD, email: "other@example.com", org_id: "evil" });

    const attrs = admin.createUser.mock.calls[0][0];
    expect(attrs.email).toBe(BASE_ROW.email);
    expect(attrs.app_metadata).toEqual({ org_id: ORG });
    expect(JSON.stringify(calls)).not.toContain("evil");
    expect(JSON.stringify(calls)).not.toContain("other@example.com");
  });
});

describe("POST /api/auth/setup-account — dead and malformed links", () => {
  it("answers an expired link as expired without creating an account", async () => {
    const { admin } = fakeService({
      row: { ...BASE_ROW, token_expires_at: new Date(Date.now() - 1000).toISOString() },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(410);
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("answers an expired link that set up an account as already set up", async () => {
    fakeService({
      row: { ...BASE_ROW, token_expires_at: new Date(Date.now() - 1000).toISOString() },
      users: new Map([[USER_ID, { email: "ada@example.com" }]]),
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: SETUP_STATUS.setUp });
  });

  it("answers a reused link as already set up without creating or changing anything", async () => {
    const { admin, calls } = fakeService({
      row: null,
      users: new Map([[USER_ID, { email: "ada@example.com" }]]),
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: SETUP_STATUS.setUp });
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(admin.updateUserById).not.toHaveBeenCalled();
    expect(consumeCalls(calls)).toEqual([]);
  });

  it("answers an unknown link as invalid", async () => {
    const { admin } = fakeService({ row: null });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Invalid or expired token" });
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it("answers a failed account lookup on a dead link as invalid, and logs it", async () => {
    fakeService({ row: null, getUserError: { status: 500, message: "down" } });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(404);
    expect(logError).toHaveBeenCalled();
  });

  it("fails closed on a lookup error with the same answer as an unknown link", async () => {
    const { admin } = fakeService({ lookupError: { code: "XX000", message: "boom" } });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Invalid or expired token" });
    expect(logError).toHaveBeenCalledWith(
      "Setup account: token lookup failed",
      expect.anything(),
      { route: "/api/auth/setup-account" },
    );
    expect(admin.getUserById).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { password: PASSWORD }],
    ["a number", { token: 42, password: PASSWORD }],
    ["too long", { token: "a".repeat(600), password: PASSWORD }],
    ["not JSON", "{"],
  ])("answers a %s token as invalid without a lookup", async (_label, body) => {
    fakeService({});
    const res = await post(body);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Invalid or expired token" });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("refuses a short password before any lookup", async () => {
    fakeService({});
    const res = await post({ token: TOKEN, password: "short" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      field: "password",
      error: "Enter a password of at least 8 characters.",
    });
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/setup-account — accounts that cannot be created", () => {
  it("creates nothing when the gate refuses an email with no approved request or invite", async () => {
    const { calls } = fakeService({
      createError: { status: 500, code: "unexpected_failure", message: "Database error creating new user" },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(500);
    expect(consumeCalls(calls)).toEqual([]);
    expect(householdWrites(calls)).toEqual([]);
  });

  it("tells the link holder an account already uses the email and leaves the link live", async () => {
    const { calls } = fakeService({
      createError: { status: 422, code: "email_exists", message: "exists" },
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ status: SETUP_STATUS.accountExists });
    expect(consumeCalls(calls)).toEqual([]);
  });

  it("returns a password the auth server calls weak as a field error", async () => {
    fakeService({ createError: { status: 422, code: "weak_password", message: "weak" } });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("password");
  });
});

describe("POST /api/auth/setup-account — partial failure and retry", () => {
  it("leaves the link live when consuming fails, and a retry finishes without a second account", async () => {
    let failConsume = true;
    const { admin, calls } = fakeService({
      respond: (call) =>
        call.table === "access_requests" && call.op === "update" && failConsume
          ? { data: null, error: { code: "XX000", message: "boom" } }
          : undefined,
    });

    const first = await post({ token: TOKEN, password: PASSWORD });
    expect(first.status).toBe(500);

    failConsume = false;
    const retry = await post({ token: TOKEN, password: "a different password" });
    expect(retry.status).toBe(200);
    expect(admin.createUser).toHaveBeenCalledTimes(1);
    expect(admin.updateUserById).toHaveBeenCalledWith(USER_ID, { password: "a different password" });
    expect(consumeCalls(calls)).toHaveLength(2);
  });

  it("does not consume the link when linking the household fails, and a retry finishes", async () => {
    let failLink = true;
    const { admin, calls } = fakeService({
      row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
      invite: {
        id: INVITE,
        family_id: "family-1",
        family_member_id: "member-1",
        invite_email: "ada@example.com",
        accepted_at: null,
      },
      respond: (call) =>
        call.table === "profiles" && failLink ? { data: [], error: null } : undefined,
    });

    const first = await post({ token: TOKEN, password: PASSWORD });
    expect(first.status).toBe(500);
    expect(consumeCalls(calls)).toEqual([]);

    failLink = false;
    const retry = await post({ token: TOKEN, password: PASSWORD });
    expect(retry.status).toBe(200);
    expect(admin.createUser).toHaveBeenCalledTimes(1);
    expect(consumeCalls(calls)).toHaveLength(1);
  });

  it.each([["family_members"], ["family_invites"]])(
    "does not consume the link when the %s write errors, and a retry finishes",
    async (table) => {
      let fail = true;
      const { calls } = fakeService({
        row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
        invite: {
          id: INVITE,
          family_id: "family-1",
          family_member_id: "member-1",
          invite_email: "ada@example.com",
          accepted_at: null,
        },
        respond: (call) =>
          call.table === table && call.op === "update" && fail
            ? { data: null, error: { message: "boom" } }
            : undefined,
      });

      const first = await post({ token: TOKEN, password: PASSWORD });
      expect(first.status).toBe(500);
      expect(consumeCalls(calls)).toEqual([]);

      fail = false;
      const retry = await post({ token: TOKEN, password: PASSWORD });
      expect(retry.status).toBe(200);
      expect(consumeCalls(calls)).toHaveLength(1);
    },
  );

  it("finishes setup when the member is already claimed by another account", async () => {
    const { calls } = fakeService({
      row: { ...BASE_ROW, invite_token: INVITE_TOKEN },
      invite: {
        id: INVITE,
        family_id: "family-1",
        family_member_id: "member-1",
        invite_email: "ada@example.com",
        accepted_at: null,
      },
      respond: (call) =>
        call.table === "family_members" && call.op === "update" ? { data: [], error: null } : undefined,
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(consumeCalls(calls)).toHaveLength(1);
  });

  it("finishes when a concurrent submit created the account first", async () => {
    const users = new Map<string, { email: string }>();
    const { admin } = fakeService({
      users,
      createError: { status: 422, code: "email_exists", message: "exists" },
    });
    admin.createUser.mockImplementationOnce(async () => {
      users.set(USER_ID, { email: "ada@example.com" });
      return { data: { user: null }, error: { status: 422, code: "email_exists", message: "exists" } };
    });

    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(admin.updateUserById).toHaveBeenCalledWith(USER_ID, { password: PASSWORD });
  });

  it("retires a token that replaced this one while the account was being set up", async () => {
    const { calls } = fakeService({
      respond: (call) =>
        call.table === "access_requests" &&
        call.op === "update" &&
        call.eqs.some(([col]) => col === "signup_token")
          ? { data: [], error: null }
          : undefined,
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
    const updates = calls.filter((c) => c.table === "access_requests" && c.op === "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).toEqual({ signup_token: null });
    expect(updates[1].eqs).toEqual([
      ["id", REQUEST],
      ["org_id", ORG],
    ]);
  });

  it("treats a link a concurrent request already consumed as consumed", async () => {
    fakeService({
      respond: (call) =>
        call.table === "access_requests" && call.op === "update" ? { data: [], error: null } : undefined,
    });
    const res = await post({ token: TOKEN, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("never puts the password in a log line or a response", async () => {
    const scenarios: Parameters<typeof fakeService>[0][] = [
      { lookupError: { message: "boom" } },
      { createError: { status: 500, message: "boom" } },
      { getUserError: { status: 500, message: "boom" } },
      {
        respond: (call) =>
          call.op === "update" ? { data: null, error: { message: "boom" } } : undefined,
      },
    ];
    for (const scenario of scenarios) {
      fakeService(scenario);
      const res = await post({ token: TOKEN, password: PASSWORD });
      expect(await res.text()).not.toContain(PASSWORD);
    }
    const logged = JSON.stringify([...logError.mock.calls, ...logWarn.mock.calls]);
    expect(logError).toHaveBeenCalled();
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(TOKEN);
  });
});
