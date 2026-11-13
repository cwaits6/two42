// The household join for a signed-in person: the invite row is the org
// anchor, every write is scoped to its org_id, and the invite is accepted
// only after the person is in the household.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };
type Call = { table: string; op: "select" | "update"; payload?: unknown; filters: unknown[][] };

let calls: Call[] = [];
let results: Record<string, Result> = {};

/** A chain that records its filters and resolves to `results["<table>.<op>"]`. */
function chain(table: string, op: Call["op"], payload?: unknown) {
  const call: Call = { table, op, payload, filters: [] };
  calls.push(call);
  const result = () => results[`${table}.${op}`] ?? { data: null, error: null };
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "is", "select"]) {
    c[m] = (...args: unknown[]) => {
      if (m !== "select") call.filters.push([m, ...args]);
      return c;
    };
  }
  c.maybeSingle = async () => result();
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return c;
}

function client() {
  return {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      update: (payload: unknown) => chain(table, "update", payload),
    }),
  };
}

let user: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    ...client(),
  }),
  createServiceClient: async () => client(),
}));

const { POST } = await import("./route");

const TOKEN = "33333333-3333-4333-8333-333333333333";
const USER = { id: "user-1", email: "Robin@Example.test" };
const INVITE = {
  id: "inv-1",
  org_id: "org-1",
  family_id: "fam-1",
  family_member_id: "mem-1",
  invite_email: "robin@example.test",
  accepted_at: null as string | null,
};
const MEMBER = { id: "mem-1", family_id: "fam-1", relationship: "spouse", claimed_profile_id: null as string | null };
const PROFILE = { org_id: "org-1", role: "member", family_id: null as string | null };

function post(body: unknown = { token: TOKEN }) {
  return POST(
    new Request("http://localhost/api/family-invites/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function given(opts: {
  invite?: typeof INVITE | null;
  member?: typeof MEMBER | null;
  profile?: typeof PROFILE | null;
}) {
  results = {
    "family_invites.select": { data: opts.invite === undefined ? INVITE : opts.invite, error: null },
    "family_members.select": { data: opts.member === undefined ? MEMBER : opts.member, error: null },
    "profiles.select": { data: opts.profile === undefined ? PROFILE : opts.profile, error: null },
    "profiles.update": { data: [{ id: USER.id }], error: null },
    "family_members.update": { data: [{ id: MEMBER.id }], error: null },
    "family_invites.update": { data: [{ id: INVITE.id }], error: null },
  };
}

const updates = () => calls.filter((c) => c.op === "update");

beforeEach(() => {
  calls = [];
  user = USER;
  given({});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("POST /api/family-invites/join", () => {
  it("refuses a signed-out caller", async () => {
    user = null;
    expect((await post()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("links the profile, claims the member, then accepts the invite, each scoped to the invite's org", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ joined: true });
    const [link, claim, accept] = updates();
    expect(updates().map((c) => c.table)).toEqual(["profiles", "family_members", "family_invites"]);

    expect(link.payload).toEqual({ family_id: "fam-1", relationship: "spouse" });
    expect(link.filters).toEqual([
      ["eq", "id", "user-1"],
      ["eq", "org_id", "org-1"],
      ["is", "family_id", null],
    ]);
    expect(claim.payload).toEqual({ claimed_profile_id: "user-1" });
    expect(claim.filters).toEqual([
      ["eq", "id", "mem-1"],
      ["eq", "org_id", "org-1"],
      ["eq", "family_id", "fam-1"],
      ["is", "claimed_profile_id", null],
    ]);
    expect(accept.filters).toEqual([
      ["eq", "id", "inv-1"],
      ["eq", "org_id", "org-1"],
      ["is", "accepted_at", null],
    ]);
    const memberRead = calls.find((c) => c.table === "family_members" && c.op === "select");
    expect(memberRead?.filters).toEqual([
      ["eq", "id", "mem-1"],
      ["eq", "org_id", "org-1"],
    ]);
  });

  it("answers a malformed, unknown and used link identically", async () => {
    const malformed = await post({ token: "nope" });
    given({ invite: null });
    const unknown = await post();
    given({ invite: { ...INVITE, accepted_at: "2026-11-01T00:00:00Z" } });
    const used = await post();

    for (const res of [malformed, unknown, used]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Invite not found" });
    }
    expect(updates()).toHaveLength(0);
  });

  it.each([
    ["another address", { profile: PROFILE }, { email: "someone@example.test" }],
    ["another church", { profile: { ...PROFILE, org_id: "org-2" } }, {}],
    ["a pending account", { profile: { ...PROFILE, role: "pending" } }, {}],
    ["no profile", { profile: null }, {}],
  ])("refuses %s without writing", async (_, state, userPatch) => {
    user = { ...USER, ...userPatch };
    given(state);

    const res = await post();

    expect(res.status).toBe(403);
    expect(updates()).toHaveLength(0);
  });

  it("refuses someone already in another household without writing", async () => {
    given({ profile: { ...PROFILE, family_id: "fam-other" } });

    expect((await post()).status).toBe(409);
    expect(updates()).toHaveLength(0);
  });

  it.each([
    ["moved to another household", { ...MEMBER, family_id: "fam-other" }],
    ["claimed by another account", { ...MEMBER, claimed_profile_id: "user-2" }],
    ["gone", null],
  ])("treats an invite whose member was %s as a dead link", async (_, member) => {
    given({ member });

    expect((await post()).status).toBe(404);
    expect(updates()).toHaveLength(0);
  });

  it("answers a repeat press after the join finished with success and no writes", async () => {
    given({
      invite: { ...INVITE, accepted_at: "2026-11-01T00:00:00Z" },
      profile: { ...PROFILE, family_id: "fam-1" },
      member: { ...MEMBER, claimed_profile_id: "user-1" },
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(0);
  });

  it("finishes a join a failure interrupted, matching the values already written", async () => {
    given({
      profile: { ...PROFILE, family_id: "fam-1" },
      member: { ...MEMBER, claimed_profile_id: "user-1" },
    });

    expect((await post()).status).toBe(200);
    const [link, claim] = updates();
    expect(link.filters).toContainEqual(["eq", "family_id", "fam-1"]);
    expect(claim.filters).toContainEqual(["eq", "claimed_profile_id", "user-1"]);
  });

  it("succeeds when a concurrent press accepted the invite first", async () => {
    results["family_invites.update"] = { data: [], error: null };

    expect((await post()).status).toBe(200);
  });

  it("stops before claiming when the profile moved to another household in between", async () => {
    results["profiles.update"] = { data: [], error: null };

    expect((await post()).status).toBe(409);
    expect(updates().map((c) => c.table)).toEqual(["profiles"]);
  });

  it("leaves the invite live when the member claim fails", async () => {
    results["family_members.update"] = { data: null, error: { message: "boom" } };

    expect((await post()).status).toBe(500);
    expect(updates().map((c) => c.table)).toEqual(["profiles", "family_members"]);
  });

  it("fails closed when the invite lookup errors", async () => {
    results["family_invites.select"] = { data: null, error: { message: "boom" } };

    expect((await post()).status).toBe(500);
    expect(calls.map((c) => c.table)).toEqual(["family_invites"]);
  });
});
