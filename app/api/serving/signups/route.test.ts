// Pins that the signup route judges "already passed" against today in the
// church's time zone, not the server's (UTC on Vercel): on a Sunday evening
// in New York it is already Monday in UTC. And that a cancel tells leaders only
// when a row went: a delete RLS refuses still succeeds, with 0 rows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createServiceClient: vi.fn(),
}));

const notifyLeadersOfCancel = vi.fn();
vi.mock("@/lib/serving/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/serving/server")>()),
  notifyLeadersOfCancel: (...args: unknown[]) => notifyLeadersOfCancel(...args),
}));

const { DELETE, POST } = await import("@/app/api/serving/signups/route");

// Every read resolves to `terminal`, so a request that clears the date check
// stops at the "not enabled" 404 for the missing team row.
function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    single: async () => terminal,
    maybeSingle: async () => terminal,
  };
  return obj;
}

function cookieClient(timezone: string) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) =>
      chain(table === "organizations" ? { data: { timezone }, error: null } : { data: null, error: null }),
  };
}

function signup(serviceDate: string) {
  return POST(
    new Request("http://localhost/api/serving/signups", {
      method: "POST",
      body: JSON.stringify({ groupId: "team-1", serviceDate, attendeeProfileIds: ["user-1"] }),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // 9:30pm Sunday, Nov 1 in New York.
  vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/serving/signups date check", () => {
  it("accepts tonight's date while it is still Sunday in the church's zone", async () => {
    createClient.mockResolvedValue(cookieClient("America/New_York"));
    const res = await signup("2026-11-01");

    expect(res.status).toBe(404);
  });

  it("refuses the same date for a church whose zone has already reached Monday", async () => {
    createClient.mockResolvedValue(cookieClient("UTC"));
    const res = await signup("2026-11-01");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Signups are for upcoming service dates only" });
  });
});

describe("DELETE /api/serving/signups", () => {
  const signupRow = {
    id: "signup-1",
    org_id: "org-1",
    team_id: "team-1",
    service_date: "2026-11-08",
    family_id: "family-1",
    created_by: "someone-else",
    teams: { name: "Greeters", group_id: "group-1" },
    serving_signup_attendees: [],
  };

  function cancelAs(deleted: unknown[]) {
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: () => ({
        ...chain({ data: signupRow, error: null }),
        delete: () => ({ eq: () => ({ select: async () => ({ data: deleted, error: null }) }) }),
      }),
    });
    return DELETE(
      new Request("http://localhost/api/serving/signups", {
        method: "DELETE",
        body: JSON.stringify({ signupId: "signup-1" }),
      }),
    );
  }

  beforeEach(() => notifyLeadersOfCancel.mockClear());

  it("gives leaders the usual notice when someone who did not sign up cancels", async () => {
    const res = await cancelAs([{ id: "signup-1" }]);

    expect(res.status).toBe(200);
    expect(notifyLeadersOfCancel).toHaveBeenCalledTimes(1);
    expect(notifyLeadersOfCancel.mock.calls[0][1]).toMatchObject({
      groupId: "group-1",
      teamId: "team-1",
      orgId: "org-1",
      serviceDates: ["2026-11-08"],
      memberLabel: "Someone",
      excludeProfileId: "user-1",
    });
  });

  it("answers 403 and tells nobody when the delete removes 0 rows", async () => {
    const res = await cancelAs([]);

    expect(res.status).toBe(403);
    expect(notifyLeadersOfCancel).not.toHaveBeenCalled();
  });
});
