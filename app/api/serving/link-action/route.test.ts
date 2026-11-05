// Pins that a signed-link signup judges "already passed" against today in the
// team's org zone, read through the HMAC-validated team row's org_id, and that
// the link books only the team's dates and the weeks the team asks for.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: () => createServiceClient(),
}));
vi.mock("@/lib/serving/links", () => ({
  verifyServingToken: () => ({ g: "team-1", p: "user-1", d: "2026-11-01", a: "signup" }),
}));
vi.mock("@/lib/serving/config", () => ({ getServingLinkMode: async () => "signed" }));

const { POST } = await import("@/app/api/serving/link-action/route");

function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    maybeSingle: async () => terminal,
  };
  return obj;
}

const orgIds: unknown[] = [];
const booked: unknown[] = [];

const ROLLING = { enabled: true, schedule: "rolling", window_weeks: 8, date_from: null, date_to: null, extra_weeks: 0 };

function serviceClient(timezone: string, settings: Record<string, unknown> = ROLLING, onTeam = false) {
  const tables: Record<string, { data: unknown; error: unknown }> = {
    teams: { data: { id: "team-1", name: "Greeters", org_id: "org-1", group_id: "grp-1" }, error: null },
    profiles: { data: { id: "user-1", org_id: "org-1", role: "member", family_id: null }, error: null },
    serving_team_settings: { data: settings, error: null },
    // Off the team, a request that clears the date check stops at the 403.
    team_members: { data: onTeam ? { profile_id: "user-1" } : null, error: null },
    organizations: { data: { timezone }, error: null },
  };
  return {
    from: (table: string) => {
      const c = chain(tables[table]);
      if (table !== "organizations") return c;
      return { ...c, select: () => ({ eq: (_col: string, id: unknown) => (orgIds.push(id), c) }) };
    },
    rpc: (_fn: string, args: { _service_date: string }) => {
      booked.push(args._service_date);
      return {
        single: async () => ({
          data: { signup_id: `s-${args._service_date}`, signup_org_id: "org-1", created: true },
          error: null,
        }),
      };
    },
  };
}

function followLink(extraDates?: string[]) {
  return POST(
    new Request("http://localhost/api/serving/link-action", {
      method: "POST",
      body: JSON.stringify({ token: "signed", extraDates }),
    }),
  );
}

beforeEach(() => {
  orgIds.length = 0;
  booked.length = 0;
  vi.useFakeTimers();
  // 9:30pm Sunday, Nov 1 in New York.
  vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/serving/link-action date check", () => {
  it("accepts tonight's date while it is still Sunday in the team's org zone", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York"));
    const res = await followLink();

    expect(res.status).toBe(403);
    expect(orgIds).toEqual(["org-1"]);
  });

  it("refuses the same date for an org whose zone has already reached Monday", async () => {
    createServiceClient.mockResolvedValue(serviceClient("UTC"));
    const res = await followLink();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "That date has already passed" });
  });
});

describe("POST /api/serving/link-action team dates", () => {
  // The link is for Sunday, Nov 1. The team asks for one more week.
  const block = (date_from: string, date_to: string) => ({
    enabled: true,
    schedule: "set",
    window_weeks: 8,
    date_from,
    date_to,
    extra_weeks: 1,
  });
  const refused = { error: "That date is not one of the team's dates" };

  it("refuses a date outside the team's set dates", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York", block("2026-11-08", "2026-11-22"), true));
    const res = await followLink();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refused);
    expect(booked).toEqual([]);
  });

  it("refuses more weeks than the team asks for", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York", block("2026-11-01", "2026-11-15"), true));
    const res = await followLink(["2026-11-08", "2026-11-15"]);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(refused);
    expect(booked).toEqual([]);
  });

  it("refuses any more weeks when the team asks for none", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York", ROLLING, true));
    const res = await followLink(["2026-11-08"]);

    expect(res.status).toBe(400);
    expect(booked).toEqual([]);
  });

  it("refuses a following week that is not after the link's date, or is past the block", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York", block("2026-11-01", "2026-11-15"), true));

    expect((await followLink(["2026-11-01"])).status).toBe(400);
    expect((await followLink(["2026-11-22"])).status).toBe(400);
    expect(booked).toEqual([]);
  });

  it("books the link's date and the one more week the team asks for", async () => {
    createServiceClient.mockResolvedValue(serviceClient("America/New_York", block("2026-11-01", "2026-11-15"), true));
    const res = await followLink(["2026-11-08"]);

    expect(res.status).toBe(200);
    expect(booked).toEqual(["2026-11-01", "2026-11-08"]);
  });
});
