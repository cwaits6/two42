// Unit test for the serving-broadcast cap-hit path. This is the
// only Tier A quota call site where a refusal changes the HTTP contract
// (429 + a specific error body) instead of silently skipping-and-logging,
// and the route's own comment states a cap-hit "must not be logged as a
// 0-recipient broadcast row" — this pins both the response shape and that
// the serving_broadcasts insert is never reached on a cap hit. Mocks
// reserveEmailQuota directly (its own fail-closed contract is already
// pinned by lib/email/quota.test.ts) and builds a minimal chainable stub
// for the cookie-bound and service Supabase clients, following the pattern
// in app/api/admin/email-domain/route.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createServiceClient: () => createServiceClient(),
}));

const reserveEmailQuota = vi.fn();
vi.mock("@/lib/email/quota", () => ({
  reserveEmailQuota: (...args: unknown[]) => reserveEmailQuota(...args),
}));

const { POST } = await import("@/app/api/serving/broadcast/route");

// A chainable query-builder stub: .eq()/.gte()/.lte()/.select() all return
// itself, and it resolves to `terminal` both via .single()/.maybeSingle()
// and via a plain `await` (the two shapes this route actually uses).
function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    gte: () => obj,
    lte: () => obj,
    insert: () => obj,
    single: async () => terminal,
    maybeSingle: async () => terminal,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

function makeCookieClient(insertSpy: (payload: unknown) => { data: unknown; error: unknown }) {
  const tables: Record<string, { data: unknown; error: unknown }> = {
    profiles: { data: { id: "user-1", role: "admin" }, error: null },
    profile_groups: { data: { is_leader: false }, error: null },
    member_groups: {
      data: { id: "group-1", name: "Greeters", org_id: "org-1" },
      error: null,
    },
    serving_team_settings: { data: { enabled: true, window_weeks: 8 }, error: null },
    serving_signups: { data: [], error: null },
    site_settings: { data: null, error: null },
  };

  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from(table: string) {
      if (table === "serving_broadcasts") {
        return { insert: (payload: unknown) => chain(insertSpy(payload)) };
      }
      return chain(tables[table]);
    },
  };
}

function makeServiceClient(members: unknown[]) {
  return {
    from() {
      return chain({
        data: members.map((profiles) => ({ profiles })),
        error: null,
      });
    },
  };
}

function broadcastRequest(groupId = "group-1") {
  return new Request("http://localhost/api/serving/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId }),
  });
}

beforeEach(() => {
  createClient.mockReset();
  createServiceClient.mockReset();
  reserveEmailQuota.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/serving/broadcast — cap hit", () => {
  it("returns 429 and never inserts a serving_broadcasts row when the org is over cap", async () => {
    const insertSpy = vi.fn(() => ({ data: null, error: null }));
    createClient.mockResolvedValue(makeCookieClient(insertSpy));
    createServiceClient.mockResolvedValue(
      makeServiceClient([
        {
          id: "member-1",
          first_name: "Sam",
          last_name: "Lee",
          preferred_name: null,
          email: "sam@example.com",
          role: "member",
          email_announcements: true,
        },
      ])
    );
    reserveEmailQuota.mockResolvedValue(false);

    const res = await POST(broadcastRequest());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "Your organization has reached its daily email limit. Try again tomorrow.",
    });
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
