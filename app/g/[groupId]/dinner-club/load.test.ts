import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadPastTables, type SeasonRow } from "./load";

vi.mock("@/lib/log", () => ({ logError: vi.fn(), stepOf: (what: string) => what }));

type Row = Record<string, string | null>;
const failed = { data: null, error: { message: "down" } };

/** Seasons by id with their previous season; seats and members tagged with their season. */
function fakeClient(
  seasons: Record<string, string | null>,
  seats: (Row & { season_id: string })[],
  members: (Row & { season_id: string })[],
  failing?: "dinner_seasons" | "dinner_seats"
) {
  const read: string[] = [];
  const from = (table: string) => {
    let id: string | null = null;
    let seasonIds: string[] = [];
    const answer = () => {
      if (table === failing) return failed;
      if (table === "dinner_seasons") {
        read.push(id!);
        return { data: id! in seasons ? [{ previous_season_id: seasons[id!] }] : [], error: null };
      }
      const rows = table === "dinner_seats" ? seats : members;
      return { data: rows.filter((r) => seasonIds.includes(r.season_id)), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (_column: string, value: string) => {
        id = value;
        return chain;
      },
      in: (_column: string, values: string[]) => {
        seasonIds = values;
        return chain;
      },
      order: () => chain,
      limit: async () => answer(),
      range: async () => answer(),
    };
    return chain;
  };
  return { client: { from } as unknown as SupabaseClient<Database>, read };
}

const season = (previous: string | null) => ({ id: "S3", previous_season_id: previous }) as SeasonRow;

const seats = [
  { season_id: "S2", table_id: "t2", party_id: "p2a" },
  { season_id: "S2", table_id: "t2", party_id: "p2b" },
  { season_id: "S1", table_id: "t1", party_id: "p1a" },
  { season_id: "S1", table_id: "t1", party_id: "p1b" },
  { season_id: "S0", table_id: "t0", party_id: "p0a" },
  { season_id: "S0", table_id: "t0", party_id: "p0b" },
];
const members = [
  { season_id: "S2", party_id: "p2a", profile_id: "ann" },
  { season_id: "S2", party_id: "p2a", profile_id: "al" },
  { season_id: "S2", party_id: "p2b", profile_id: "bea" },
  { season_id: "S1", party_id: "p1a", profile_id: "ann" },
  { season_id: "S1", party_id: "p1b", profile_id: "cy" },
  { season_id: "S0", party_id: "p0a", profile_id: "ann" },
  { season_id: "S0", party_id: "p0b", profile_id: "dee" },
];

describe("loadPastTables", () => {
  it("returns the two seasons before this one, each table as its parties' people, and nothing older", async () => {
    const { client } = fakeClient({ S2: "S1", S1: "S0", S0: null }, seats, members);
    expect(await loadPastTables(client, season("S2"))).toEqual([
      [["ann", "al"], ["bea"]],
      [["ann"], ["cy"]],
    ]);
  });

  it("stops at a season that is gone", async () => {
    const { client } = fakeClient({ S1: "S0", S0: null }, seats, members);
    expect(await loadPastTables(client, season("S2"))).toEqual([[["ann", "al"], ["bea"]]]);
  });

  it("reads nothing for a first season", async () => {
    const { client, read } = fakeClient({}, seats, members);
    expect(await loadPastTables(client, season(null))).toEqual([]);
    expect(read).toEqual([]);
  });

  it("returns null when a season or seat read fails", async () => {
    const chain = { S2: "S1", S1: "S0", S0: null };
    expect(await loadPastTables(fakeClient(chain, seats, members, "dinner_seasons").client, season("S2"))).toBeNull();
    expect(await loadPastTables(fakeClient(chain, seats, members, "dinner_seats").client, season("S2"))).toBeNull();
  });
});
