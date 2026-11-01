// Pins that a signed-link signup judges "already passed" against today in the
// team's org zone, read through the HMAC-validated team row's org_id.
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

function serviceClient(timezone: string) {
  const tables: Record<string, { data: unknown; error: unknown }> = {
    teams: { data: { id: "team-1", name: "Greeters", org_id: "org-1", group_id: "grp-1" }, error: null },
    profiles: { data: { id: "user-1", org_id: "org-1", role: "member", family_id: null }, error: null },
    serving_team_settings: { data: { enabled: true }, error: null },
    // No membership: a request that clears the date check stops at the 403.
    team_members: { data: null, error: null },
    organizations: { data: { timezone }, error: null },
  };
  return {
    from: (table: string) => {
      const c = chain(tables[table]);
      if (table !== "organizations") return c;
      return { ...c, select: () => ({ eq: (_col: string, id: unknown) => (orgIds.push(id), c) }) };
    },
  };
}

function followLink() {
  return POST(
    new Request("http://localhost/api/serving/link-action", {
      method: "POST",
      body: JSON.stringify({ token: "signed" }),
    }),
  );
}

beforeEach(() => {
  orgIds.length = 0;
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
