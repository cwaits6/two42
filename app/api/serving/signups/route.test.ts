// Pins that the signup route judges "already passed" against today in the
// church's time zone, not the server's (UTC on Vercel): on a Sunday evening
// in New York it is already Monday in UTC. That a request books only the
// team's dates and the weeks the team asks for. That a spouse added to a date
// is told about the couple. And that a cancel tells leaders only when a row
// went: a delete RLS refuses still succeeds, with 0 rows.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createServiceClient: () => createServiceClient(),
}));

const notifyLeadersOfCancel = vi.fn();
const sendSignupConfirmation = vi.fn();
vi.mock("@/lib/serving/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/serving/server")>()),
  notifyLeadersOfCancel: (...args: unknown[]) => notifyLeadersOfCancel(...args),
  sendSignupConfirmation: (...args: unknown[]) => sendSignupConfirmation(...args),
}));

const { DELETE, PATCH, POST } = await import("@/app/api/serving/signups/route");

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
  createServiceClient.mockReset();
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

describe("POST /api/serving/signups team dates", () => {
  // Sunday, Nov 1 in New York. The block holds Nov 1, 8 and 15, and the team
  // asks for one more week.
  const me = { id: "user-1", first_name: "Ann", last_name: "Lee", preferred_name: null, email: null, family_id: null, relationship: null };
  const booked: string[] = [];

  function teamClient(rpcError: { code: string } | null = null) {
    const rows: Record<string, unknown> = {
      organizations: { timezone: "America/New_York" },
      teams: { id: "team-1", name: "Greeters", org_id: "org-1", group_id: "grp-1" },
      serving_team_settings: {
        enabled: true,
        schedule: "set",
        window_weeks: 8,
        date_from: "2026-11-01",
        date_to: "2026-11-15",
        extra_weeks: 1,
      },
      profiles: me,
    };
    return {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        const read = chain({ data: rows[table], error: null });
        // The attendee read is awaited as a list.
        return { ...read, select: () => ({ ...read, in: async () => ({ data: [rows[table]], error: null }) }) };
      },
      rpc: (_fn: string, args: { _service_date: string }) => ({
        single: async () => {
          if (rpcError) return { data: null, error: rpcError };
          booked.push(args._service_date);
          return { data: { signup_id: `s-${args._service_date}`, signup_org_id: "org-1", created: true }, error: null };
        },
      }),
    };
  }

  function request(serviceDate: string, extraDates?: string[]) {
    return POST(
      new Request("http://localhost/api/serving/signups", {
        method: "POST",
        body: JSON.stringify({ groupId: "team-1", serviceDate, extraDates, attendeeProfileIds: ["user-1"] }),
      }),
    );
  }

  beforeEach(() => {
    booked.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("refuses a date after the team's set dates", async () => {
    createClient.mockResolvedValue(teamClient());
    const res = await request("2026-11-22");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That date is not one of the team's dates" });
    expect(booked).toEqual([]);
  });

  it("refuses more weeks than the team asks for", async () => {
    createClient.mockResolvedValue(teamClient());
    const res = await request("2026-11-01", ["2026-11-08", "2026-11-15"]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The team does not ask for those weeks" });
    expect(booked).toEqual([]);
  });

  it("refuses a following week that is not after the chosen date", async () => {
    createClient.mockResolvedValue(teamClient());
    const res = await request("2026-11-08", ["2026-11-01"]);

    expect(res.status).toBe(400);
    expect(booked).toEqual([]);
  });

  it("books the chosen date and the one more week the team asks for", async () => {
    createClient.mockResolvedValue(teamClient());
    const res = await request("2026-11-01", ["2026-11-08"]);

    expect(res.status).toBe(200);
    expect(booked).toEqual(["2026-11-01", "2026-11-08"]);
  });

  it("answers 400 when the database refuses the date", async () => {
    createClient.mockResolvedValue(teamClient({ code: "SV006" }));
    const res = await request("2026-11-01");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That date is not one of the team's dates" });
  });
});

describe("PATCH /api/serving/signups", () => {
  const david = { id: "david", first_name: "David", last_name: "Reyes", preferred_name: null };
  const lena = { id: "lena", first_name: "Lena", last_name: "Reyes", preferred_name: null };
  const addresses = [
    { id: "david", email: "david@example.test" },
    { id: "lena", email: "lena@example.test" },
  ];

  // The request client carries no address; they come from a service read
  // scoped to the signup row's org.
  function serviceClient(result: { data: unknown; error: unknown }, filters: [string, unknown][] = []) {
    return {
      from: () => ({
        select: () => ({
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return { in: async () => result };
          },
        }),
      }),
    };
  }

  function changeClient() {
    return {
      auth: { getUser: async () => ({ data: { user: { id: "david" } } }) },
      from: (table: string) =>
        table === "serving_signups"
          ? chain({
              data: {
                id: "signup-1",
                org_id: "org-1",
                team_id: "team-1",
                service_date: "2026-11-08",
                teams: { name: "Greeters", group_id: "grp-1" },
                serving_signup_attendees: [{ profile_id: "david" }],
              },
              error: null,
            })
          : { select: () => ({ in: async () => ({ data: [david, lena], error: null }) }) },
      rpc: () => ({ single: async () => ({ data: { added: 1, removed: 0 }, error: null }) }),
    };
  }

  const addLena = () =>
    PATCH(
      new Request("http://localhost/api/serving/signups", {
        method: "PATCH",
        body: JSON.stringify({ signupId: "signup-1", attendeeProfileIds: ["david", "lena"] }),
      }),
    );

  it("mails only the spouse just added, naming both people on the date", async () => {
    sendSignupConfirmation.mockReset();
    createClient.mockResolvedValue(changeClient());
    const filters: [string, unknown][] = [];
    createServiceClient.mockResolvedValue(serviceClient({ data: addresses, error: null }, filters));

    const res = await addLena();

    expect(res.status).toBe(200);
    expect(filters).toEqual([["org_id", "org-1"]]);
    expect(sendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(sendSignupConfirmation.mock.calls[0][1]).toMatchObject({
      serviceDate: "2026-11-08",
      recipient: { id: "lena", email: "lena@example.test" },
      attendees: [david, lena],
    });
  });

  it("keeps the change and mails nobody when the addresses can't be read", async () => {
    sendSignupConfirmation.mockReset();
    createClient.mockResolvedValue(changeClient());
    createServiceClient.mockResolvedValue(serviceClient({ data: null, error: { code: "XX000" } }));
    expect((await addLena()).status).toBe(200);

    createServiceClient.mockRejectedValue(new Error("no service key"));
    expect((await addLena()).status).toBe(200);
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
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
