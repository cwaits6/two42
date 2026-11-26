// Dinner club emails go out on the service client, which bypasses row
// security, so the recipient filters in notify.ts are the only thing between
// a home address's table and someone who left it or asked for no email. The
// fake client applies every `.eq()` / `.in()` / `.is()` predicate to the rows
// it holds, so a dropped filter changes who is mailed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: () => createServiceClient() }));

const send = vi.fn();
vi.mock("resend", () => ({
  // A regular function: getResend() calls `new Resend(...)`.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const reserveEmailQuota = vi.fn();
vi.mock("@/lib/email/quota", () => ({ reserveEmailQuota: (...args: unknown[]) => reserveEmailQuota(...args) }));

vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: async () => ({
    orgName: "Hillside",
    replyTo: null,
    accent: "#B85C38",
    fromAddress: "noreply@hillside.example",
    baseUrl: "https://two42.example",
  }),
  formatFromHeader: (name: string, address: string) => `${name} <${address}>`,
}));

vi.mock("@/lib/time/orgZone", () => ({ orgTimeZoneById: async () => "America/Chicago" }));

vi.mock("@/lib/log", () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }));

const { notifyDinnersMoved, notifyTablesPublished } = await import("@/lib/dinnerClub/notify");

const ORG = "org-a";
const OTHER_ORG = "org-b";
const OLD = "2031-01-05T00:00:00.000Z";
const NEW = "2031-01-12T00:00:00.000Z";

type Row = Record<string, unknown>;

const person = (id: string, extra: Row = {}): Row => ({
  id,
  org_id: ORG,
  email: `${id}@example.org`,
  first_name: id,
  preferred_name: null,
  role: "member",
  email_dinner_club: true,
  ...extra,
});

function seed(): Record<string, Row[]> {
  return {
    dinner_seasons: [
      { org_id: ORG, id: "s1", group_id: "g1", title: "Supper Club", status: "published" },
      { org_id: OTHER_ORG, id: "s1", group_id: "g9", title: "Other Supper", status: "published" },
    ],
    dinners: [
      { org_id: ORG, id: "d1", table_id: "t1", season_id: "s1", group_id: "g1", starts_at: NEW, host_party_id: "p-host" },
      { org_id: ORG, id: "d2", table_id: "t2", season_id: "s1", group_id: "g1", starts_at: NEW, host_party_id: "p-other" },
      { org_id: OTHER_ORG, id: "d9", table_id: "t1", season_id: "s1", group_id: "g9", starts_at: NEW, host_party_id: "p-x" },
    ],
    dinner_seats: [
      { org_id: ORG, season_id: "s1", table_id: "t1", party_id: "p-host", left_at: null },
      { org_id: ORG, season_id: "s1", table_id: "t1", party_id: "p-on", left_at: null },
      { org_id: ORG, season_id: "s1", table_id: "t1", party_id: "p-off", left_at: null },
      { org_id: ORG, season_id: "s1", table_id: "t1", party_id: "p-gone", left_at: "2030-12-01T00:00:00.000Z" },
      { org_id: ORG, season_id: "s1", table_id: "t1", party_id: "p-pending", left_at: null },
      { org_id: ORG, season_id: "s1", table_id: "t2", party_id: "p-other", left_at: null },
      // Another church's seat on a table with the same id must never count.
      { org_id: OTHER_ORG, season_id: "s1", table_id: "t1", party_id: "p-x", left_at: null },
    ],
    dinner_party_members: [
      { org_id: ORG, season_id: "s1", party_id: "p-host", profile_id: "mover" },
      { org_id: ORG, season_id: "s1", party_id: "p-host", profile_id: "partner" },
      { org_id: ORG, season_id: "s1", party_id: "p-on", profile_id: "gina" },
      { org_id: ORG, season_id: "s1", party_id: "p-off", profile_id: "oscar" },
      { org_id: ORG, season_id: "s1", party_id: "p-gone", profile_id: "wendy" },
      { org_id: ORG, season_id: "s1", party_id: "p-pending", profile_id: "pat" },
      { org_id: ORG, season_id: "s1", party_id: "p-other", profile_id: "olga" },
      { org_id: OTHER_ORG, season_id: "s1", party_id: "p-x", profile_id: "xavier" },
    ],
    profiles: [
      person("mover"),
      person("partner"),
      person("gina"),
      person("oscar", { email_dinner_club: false }),
      person("wendy"),
      person("pat", { role: "pending" }),
      person("olga"),
      person("xavier", { org_id: OTHER_ORG }),
    ],
  };
}

interface Chain {
  table: string;
  orgIds: unknown[];
}

function fakeClient(rows: Record<string, Row[]>) {
  const chains: Chain[] = [];
  const client = {
    from(table: string) {
      const chain: Chain = { table, orgIds: [] };
      chains.push(chain);
      const tests: Array<(row: Row) => boolean> = [];
      let single = false;
      const result = () => {
        const found = (rows[table] ?? []).filter((row) => tests.every((t) => t(row)));
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const q = {
        select: () => q,
        order: () => q,
        eq(col: string, val: unknown) {
          if (col === "org_id") chain.orgIds.push(val);
          tests.push((row) => row[col] === val);
          return q;
        },
        in(col: string, vals: unknown[]) {
          tests.push((row) => vals.includes(row[col]));
          return q;
        },
        is(col: string, val: null) {
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

function ended(): Record<string, Row[]> {
  const rows = seed();
  rows.dinner_seasons = rows.dinner_seasons.map((s) => ({ ...s, status: "ended" }));
  return rows;
}

const sentTo = () => send.mock.calls.map(([msg]) => (msg as { to: string }).to).sort();

describe("notifyDinnersMoved", () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ data: { id: "x" }, error: null });
    reserveEmailQuota.mockReset().mockResolvedValue(true);
  });

  it("emails everyone still at the table who wants dinner club email, except the person who moved it", async () => {
    const { client, chains } = fakeClient(seed());
    createServiceClient.mockResolvedValue(client);

    const result = await notifyDinnersMoved(ORG, [{ dinnerId: "d1", oldStartsAt: OLD }], "mover");

    expect(sentTo()).toEqual(["gina@example.org", "partner@example.org"]);
    expect(result).toEqual({ sent: 2, failed: 0, capped: false });
    expect(reserveEmailQuota).toHaveBeenCalledWith(ORG, 2);
    for (const chain of chains) expect(chain.orgIds, chain.table).toEqual([ORG]);
  });

  it("sends nothing when the dinner's time did not change", async () => {
    createServiceClient.mockResolvedValue(fakeClient(seed()).client);

    const result = await notifyDinnersMoved(ORG, [{ dinnerId: "d1", oldStartsAt: NEW }], "mover");

    expect(send).not.toHaveBeenCalled();
    expect(reserveEmailQuota).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, capped: false });
  });

  it("sends nothing when the church's daily email cap refuses the batch", async () => {
    reserveEmailQuota.mockResolvedValue(false);
    createServiceClient.mockResolvedValue(fakeClient(seed()).client);

    const result = await notifyDinnersMoved(ORG, [{ dinnerId: "d1", oldStartsAt: OLD }], "mover");

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, capped: true });
  });

  it("sends nothing for a dinner of an ended season", async () => {
    createServiceClient.mockResolvedValue(fakeClient(ended()).client);

    const result = await notifyDinnersMoved(ORG, [{ dinnerId: "d1", oldStartsAt: OLD }], "mover");

    expect(send).not.toHaveBeenCalled();
    expect(reserveEmailQuota).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, capped: false });
  });

  it("counts a send the email provider rejects as failed and keeps going", async () => {
    send.mockImplementation(async (msg: { to: string }) =>
      msg.to === "gina@example.org"
        ? { data: null, error: { name: "validation_error", message: "rejected" } }
        : { data: { id: "x" }, error: null },
    );
    createServiceClient.mockResolvedValue(fakeClient(seed()).client);

    const result = await notifyDinnersMoved(ORG, [{ dinnerId: "d1", oldStartsAt: OLD }], "mover");

    expect(sentTo()).toEqual(["gina@example.org", "partner@example.org"]);
    expect(result).toEqual({ sent: 1, failed: 1, capped: false });
  });
});

describe("notifyTablesPublished", () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ data: { id: "x" }, error: null });
    reserveEmailQuota.mockReset().mockResolvedValue(true);
  });

  it("emails only the people named who are still seated and want dinner club email, all within the church", async () => {
    const { client, chains } = fakeClient(seed());
    createServiceClient.mockResolvedValue(client);

    // Olga is seated but not named; Xavier is named but in another church.
    const result = await notifyTablesPublished(ORG, "s1", [
      "mover",
      "partner",
      "gina",
      "oscar",
      "wendy",
      "pat",
      "xavier",
    ]);

    expect(sentTo()).toEqual(["gina@example.org", "mover@example.org", "partner@example.org"]);
    expect(result).toEqual({ sent: 3, failed: 0, capped: false });
    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) expect(chain.orgIds, chain.table).toEqual([ORG]);
  });

  it("sends nothing for an ended season", async () => {
    createServiceClient.mockResolvedValue(fakeClient(ended()).client);
    expect(await notifyTablesPublished(ORG, "s1", ["mover", "partner", "gina"])).toEqual({ sent: 0, failed: 0, capped: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when nobody is named", async () => {
    createServiceClient.mockResolvedValue(fakeClient(seed()).client);
    expect(await notifyTablesPublished(ORG, "s1", [])).toEqual({ sent: 0, failed: 0, capped: false });
    expect(send).not.toHaveBeenCalled();
  });
});
