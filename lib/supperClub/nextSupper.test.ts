// Home's next supper. Row security is what limits a member to their own
// table; the fake client here stands in for it by holding only the rows the
// member could read, and applies every predicate so a dropped filter changes
// what Home shows.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("@/lib/log", () => ({ logError: () => {}, logWarn: () => {}, stepOf: (s: string) => s }));

const { loadNextSupper } = await import("@/lib/supperClub/nextSupper");

type Row = Record<string, unknown>;
const ORG = "org-a";
const NOW = new Date("2031-01-10T00:00:00.000Z");
const PAST = "2031-01-05T00:00:00.000Z";
const NEXT = "2031-01-12T00:00:00.000Z";
const LATER = "2031-02-12T00:00:00.000Z";

function seed(): Record<string, Row[]> {
  const o = { org_id: ORG };
  return {
    group_settings: [{ ...o, group_id: "g1", supper_club_enabled: true }],
    supper_rotations: [{ ...o, id: "s1", group_id: "g1", title: "Winter Suppers", status: "published", bring_list_enabled: true }],
    supper_party_members: [
      { ...o, rotation_id: "s1", party_id: "p-me", profile_id: "me" },
      { ...o, rotation_id: "s1", party_id: "p-host", profile_id: "henry" },
      { ...o, rotation_id: "s1", party_id: "p-host", profile_id: "chloe" },
    ],
    supper_seats: [
      { ...o, table_id: "t1", party_id: "p-me", left_at: null },
      { ...o, table_id: "t1", party_id: "p-host", left_at: null },
    ],
    suppers: [
      { ...o, id: "d-past", table_id: "t1", starts_at: PAST, host_party_id: "p-host" },
      { ...o, id: "d-later", table_id: "t1", starts_at: LATER, host_party_id: "p-host" },
      { ...o, id: "d-next", table_id: "t1", starts_at: NEXT, host_party_id: "p-host" },
    ],
    supper_party_addresses: [
      { ...o, party_id: "p-host", address_line1: "12 Fixture Lane", address_line2: null, city: "Springfield", state: null, postal_code: null },
    ],
    supper_replies: [
      { ...o, supper_id: "d-next", profile_id: "me", status: "going" },
      { ...o, supper_id: "d-later", profile_id: "me", status: "not_going" },
    ],
    supper_contributions: [
      { ...o, supper_id: "d-next", party_id: "p-me", item: "Dessert" },
      { ...o, supper_id: "d-next", party_id: "p-other", item: "Bread" },
    ],
    profiles: [
      { ...o, id: "henry", first_name: "Henry", preferred_name: null },
      { ...o, id: "chloe", first_name: "Chloe", preferred_name: null },
    ],
  };
}

function fakeClient(rows: Record<string, Row[]>, failing?: string) {
  return {
    from(table: string) {
      const tests: Array<(row: Row) => boolean> = [];
      let sortBy: string | null = null;
      let limit = Infinity;
      let single = false;
      const result = () => {
        if (table === failing) return { data: null, error: { code: "57014", message: "timeout" } };
        let found = (rows[table] ?? []).filter((row) => tests.every((t) => t(row)));
        if (sortBy) found = [...found].sort((a, b) => String(a[sortBy!]).localeCompare(String(b[sortBy!])));
        found = found.slice(0, limit);
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const q = {
        select: () => q,
        eq(col: string, val: unknown) {
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
        gt(col: string, val: string) {
          tests.push((row) => String(row[col]) > val);
          return q;
        },
        order(col: string) {
          sortBy = col;
          return q;
        },
        limit(n: number) {
          limit = n;
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
  } as unknown as SupabaseClient<Database>;
}

const load = (rows: Record<string, Row[]>, failing?: string) =>
  loadNextSupper(fakeClient(rows, failing), { orgId: ORG, groupId: "g1", userId: "me", now: NOW });

describe("loadNextSupper", () => {
  it("is the soonest supper still to come at the member's table, with its host, address, reply and what they bring", async () => {
    expect(await load(seed())).toEqual({
      supper: {
        startsAt: NEXT,
        rotationTitle: "Winter Suppers",
        isHost: false,
        hostNames: "Henry and Chloe",
        address: "12 Fixture Lane, Springfield",
        reply: "going",
        bringing: "Dessert",
      },
    });
  });

  it("tells the host it's theirs, with no list of what to bring", async () => {
    const rows = seed();
    rows.suppers = rows.suppers.map((d) => ({ ...d, host_party_id: "p-me" }));
    rows.supper_party_addresses = [{ ...rows.supper_party_addresses[0], party_id: "p-me", address_line1: "1 Home Row" }];
    expect((await load(rows))?.supper).toMatchObject({ isHost: true, hostNames: null, address: "1 Home Row, Springfield", bringing: null });
  });

  it("is none when the group's Supper club is off", async () => {
    const rows = seed();
    rows.group_settings[0].supper_club_enabled = false;
    expect(await load(rows)).toEqual({ supper: null });
  });

  it("is none for a member at no table", async () => {
    const rows = seed();
    rows.supper_seats = rows.supper_seats.filter((s) => s.party_id !== "p-me");
    expect(await load(rows)).toEqual({ supper: null });
  });

  it("is none once the member's party has left its table", async () => {
    const rows = seed();
    rows.supper_seats = rows.supper_seats.map((s) => (s.party_id === "p-me" ? { ...s, left_at: PAST } : s));
    expect(await load(rows)).toEqual({ supper: null });
  });

  it("is none when no rotation is published", async () => {
    const rows = seed();
    rows.supper_rotations[0].status = "ended";
    expect(await load(rows)).toEqual({ supper: null });
  });

  it("is none when every supper has happened", async () => {
    const rows = seed();
    rows.suppers = rows.suppers.filter((d) => d.starts_at === PAST);
    expect(await load(rows)).toEqual({ supper: null });
  });

  it("leaves out the address when row security gives none", async () => {
    const rows = seed();
    rows.supper_party_addresses = [];
    expect((await load(rows))?.supper?.address).toBeNull();
  });

  it("leaves out what to bring when the rotation's hosts don't say", async () => {
    const rows = seed();
    rows.supper_rotations[0].bring_list_enabled = false;
    expect((await load(rows))?.supper?.bringing).toBeNull();
  });

  it.each(["group_settings", "supper_rotations", "supper_seats", "suppers", "supper_party_addresses", "profiles"])(
    "is null when the %s read fails",
    async (table) => {
      expect(await load(seed(), table)).toBeNull();
    },
  );
});
