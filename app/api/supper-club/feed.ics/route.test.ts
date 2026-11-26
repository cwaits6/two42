// The supper feed runs on the service client, which bypasses row security,
// so its own filters are the boundary. The stub applies the route's
// `.eq()` / `.in()` / `.is()` predicates to the rows it holds, so a dropped
// predicate would put another table's address, or another church's, in the
// body.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSubscriptionToken } from "@/lib/calendar/subscription-token";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));

const logged: unknown[][] = [];
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => void logged.push(args),
  logWarn: (...args: unknown[]) => void logged.push(args),
}));

const { GET } = await import("@/app/api/supper-club/feed.ics/route");

const TOKEN = "11111111-1111-4111-8111-111111111111";
const ORG = "org-a";
const OTHER_ORG = "org-b";
const ISAAC = "isaac";

type Row = Record<string, unknown>;

function seed(): Record<string, Row[]> {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  return {
    supper_feed_tokens: [
      { profile_id: ISAAC, org_id: ORG, token_hash: hashSubscriptionToken(TOKEN), expires_at: future },
    ],
    profiles: [
      { id: ISAAC, org_id: ORG, role: "member", first_name: "Isaac", preferred_name: null },
      { id: "henry", org_id: ORG, role: "member", first_name: "Henry", preferred_name: null },
      { id: "chloe", org_id: ORG, role: "member", first_name: "Chloe", preferred_name: null },
      { id: "leo", org_id: ORG, role: "member", first_name: "Leo", preferred_name: null },
    ],
    supper_party_members: [
      { org_id: ORG, party_id: "p-isaac", profile_id: ISAAC },
      { org_id: ORG, party_id: "p-henry", profile_id: "henry" },
      { org_id: ORG, party_id: "p-henry", profile_id: "chloe" },
      { org_id: ORG, party_id: "p-leo", profile_id: "leo" },
      // Another church's party with the same person id must never count.
      { org_id: OTHER_ORG, party_id: "p-other", profile_id: ISAAC },
    ],
    supper_seats: [
      { org_id: ORG, table_id: "t1", party_id: "p-henry", rotation_id: "s1", group_id: "g1", seated_at: "2030-11-01T00:00:00.000Z", left_at: null },
      { org_id: ORG, table_id: "t1", party_id: "p-isaac", rotation_id: "s1", group_id: "g1", seated_at: "2030-11-01T00:00:00.000Z", left_at: null },
      { org_id: ORG, table_id: "t2", party_id: "p-leo", rotation_id: "s1", group_id: "g1", seated_at: "2030-11-01T00:00:00.000Z", left_at: null },
      { org_id: OTHER_ORG, table_id: "t9", party_id: "p-other", rotation_id: "s9", group_id: "g9", seated_at: "2030-11-01T00:00:00.000Z", left_at: null },
    ],
    group_settings: [
      { org_id: ORG, group_id: "g1", supper_club_enabled: true },
      { org_id: OTHER_ORG, group_id: "g9", supper_club_enabled: true },
    ],
    supper_rotations: [
      { org_id: ORG, id: "s1", title: "Fixture Supper Club", status: "published" },
      { org_id: OTHER_ORG, id: "s9", title: "Other Supper", status: "published" },
    ],
    suppers: [
      { org_id: ORG, id: "d1", table_id: "t1", rotation_id: "s1", starts_at: "2031-01-05T00:00:00.000Z", length_minutes: 120, host_party_id: "p-henry" },
      { org_id: ORG, id: "d2", length_minutes: 180, table_id: "t2", rotation_id: "s1", starts_at: "2031-01-05T00:00:00.000Z", host_party_id: "p-leo" },
      { org_id: OTHER_ORG, id: "d9", length_minutes: 180, table_id: "t9", rotation_id: "s9", starts_at: "2031-01-05T00:00:00.000Z", host_party_id: "p-other" },
    ],
    supper_party_addresses: [
      { org_id: ORG, party_id: "p-henry", address_line1: "12 Fixture Lane", address_line2: null, city: null, state: null, postal_code: null },
      { org_id: ORG, party_id: "p-leo", address_line1: "48 Sample Row", address_line2: null, city: null, state: null, postal_code: null },
      { org_id: OTHER_ORG, party_id: "p-other", address_line1: "9 Elsewhere Road", address_line2: null, city: null, state: null, postal_code: null },
    ],
    organizations: [{ id: ORG, timezone: "America/Chicago" }],
  };
}

interface Chain {
  table: string;
  filters: string[];
}

function fakeClient(rows: Record<string, Row[]>, opts: { failTokenRead?: boolean } = {}) {
  const chains: Chain[] = [];
  const client = {
    from(table: string) {
      const chain: Chain = { table, filters: [] };
      chains.push(chain);
      const tests: Array<(row: Row) => boolean> = [];
      let single = false;
      const result = () => {
        if (opts.failTokenRead && table === "supper_feed_tokens") return { data: null, error: { code: "57014", message: "x" } };
        const found = (rows[table] ?? []).filter((row) => tests.every((t) => t(row)));
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const q = {
        select: () => q,
        update: () => q,
        eq(col: string, val: unknown) {
          chain.filters.push(`${col}=${String(val)}`);
          tests.push((row) => row[col] === val);
          return q;
        },
        in(col: string, vals: unknown[]) {
          chain.filters.push(`${col} in`);
          tests.push((row) => vals.includes(row[col]));
          return q;
        },
        is(col: string, val: null) {
          chain.filters.push(`${col} is null`);
          tests.push((row) => row[col] === val);
          return q;
        },
        maybeSingle() {
          single = true;
          return Promise.resolve(result());
        },
        then(resolve: (v: unknown) => unknown) {
          return resolve(result());
        },
      };
      return q;
    },
  };
  return { client, chains };
}

const feed = (token: string | null) =>
  GET(new Request(`https://two42.example/api/supper-club/feed.ics${token === null ? "" : `?token=${token}`}`));

describe("GET /api/supper-club/feed.ics", () => {
  beforeEach(() => {
    logged.length = 0;
  });

  it("lists only the person's own table's suppers, with its time and address, privately", async () => {
    const { client, chains } = fakeClient(seed());
    createServiceClient.mockResolvedValue(client);
    const res = await feed(TOKEN);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toMatch(/^private/);
    expect(body).toContain("UID:supper-d1@two42");
    expect(body).toContain("LOCATION:12 Fixture Lane");
    expect(body).toContain("DTSTART:20310105T000000Z");
    expect(body).toContain("DTEND:20310105T020000Z");
    expect(body).not.toContain("48 Sample Row");
    expect(body).not.toContain("d2@two42");
    expect(body).not.toContain("9 Elsewhere Road");

    // Every read after the token lookup is scoped to the token row's church.
    const afterToken = chains.slice(1).filter((c) => c.table !== "supper_feed_tokens" || c.filters.length > 0);
    for (const chain of afterToken) {
      if (chain.table === "organizations") continue;
      expect(chain.filters, chain.table).toContain(`org_id=${ORG}`);
    }
  });

  it("answers a missing, unknown, expired and unreadable token the same way, and never logs it", async () => {
    const answers: string[] = [];
    const expired = seed();
    expired.supper_feed_tokens[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const cases: Array<[string | null, Record<string, Row[]>, { failTokenRead?: boolean }]> = [
      [null, seed(), {}],
      ["not-a-token", seed(), {}],
      ["22222222-2222-4222-8222-222222222222", seed(), {}],
      [TOKEN, expired, {}],
      [TOKEN, seed(), { failTokenRead: true }],
    ];
    for (const [token, rows, opts] of cases) {
      createServiceClient.mockResolvedValue(fakeClient(rows, opts).client);
      const res = await feed(token);
      answers.push(`${res.status} ${res.headers.get("Cache-Control")} ${await res.text()}`);
    }
    expect(new Set(answers)).toEqual(new Set(["401 private, no-store Unauthorized"]));
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    expect(JSON.stringify(logged)).not.toContain(hashSubscriptionToken(TOKEN));
  });

  it("returns no suppers once the old link is replaced", async () => {
    const rows = seed();
    rows.supper_feed_tokens[0].token_hash = hashSubscriptionToken("33333333-3333-4333-8333-333333333333");
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const res = await feed(TOKEN);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("VEVENT");
  });

  it("lists nothing once the person's party has left its table", async () => {
    const rows = seed();
    const seat = rows.supper_seats.find((s) => s.party_id === "p-isaac");
    seat!.left_at = "2030-12-01T00:00:00.000Z";
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const res = await feed(TOKEN);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body).not.toContain("12 Fixture Lane");
  });

  it("keeps the supper but drops the address once its host has left the table", async () => {
    const rows = seed();
    const seat = rows.supper_seats.find((s) => s.party_id === "p-henry");
    seat!.left_at = "2030-12-01T00:00:00.000Z";
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const body = await (await feed(TOKEN)).text();
    expect(body).toContain("UID:supper-d1@two42");
    expect(body).not.toContain("12 Fixture Lane");
  });

  it("keeps a supper from before the person was seated, without its host's address", async () => {
    const rows = seed();
    const seat = rows.supper_seats.find((s) => s.party_id === "p-isaac");
    seat!.seated_at = "2031-01-06T00:00:00.000Z";
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const body = await (await feed(TOKEN)).text();
    expect(body).toContain("UID:supper-d1@two42");
    expect(body).not.toContain("12 Fixture Lane");
  });

  it("gives the host's address on every supper once one of theirs is still to come for the person", async () => {
    const rows = seed();
    const seat = rows.supper_seats.find((s) => s.party_id === "p-isaac");
    seat!.seated_at = "2031-01-06T00:00:00.000Z";
    rows.suppers.push({ org_id: ORG, id: "d3", table_id: "t1", rotation_id: "s1", starts_at: "2031-02-05T00:00:00.000Z", length_minutes: 120, host_party_id: "p-henry" });
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const body = await (await feed(TOKEN)).text();
    expect(body).toContain("UID:supper-d3@two42");
    expect(body).toContain("12 Fixture Lane");
  });

  it("drops a group whose leader turned the Supper club off", async () => {
    const rows = seed();
    rows.group_settings[0].supper_club_enabled = false;
    createServiceClient.mockResolvedValue(fakeClient(rows).client);
    const body = await (await feed(TOKEN)).text();
    expect(body).not.toContain("VEVENT");
  });
});
