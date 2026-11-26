import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loadPastTables, type RotationRow } from "./load";

vi.mock("@/lib/log", () => ({ logError: vi.fn(), stepOf: (what: string) => what }));

type Row = Record<string, string | null>;
const failed = { data: null, error: { message: "down" } };

/** Rotations by id with their previous rotation; seats and members tagged with their rotation. */
function fakeClient(
  rotations: Record<string, string | null>,
  seats: (Row & { rotation_id: string })[],
  members: (Row & { rotation_id: string })[],
  failing?: "supper_rotations" | "supper_seats"
) {
  const read: string[] = [];
  const from = (table: string) => {
    let id: string | null = null;
    let rotationIds: string[] = [];
    const answer = () => {
      if (table === failing) return failed;
      if (table === "supper_rotations") {
        read.push(id!);
        return { data: id! in rotations ? [{ previous_rotation_id: rotations[id!] }] : [], error: null };
      }
      const rows = table === "supper_seats" ? seats : members;
      return { data: rows.filter((r) => rotationIds.includes(r.rotation_id)), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (_column: string, value: string) => {
        id = value;
        return chain;
      },
      in: (_column: string, values: string[]) => {
        rotationIds = values;
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

const rotation = (previous: string | null) => ({ id: "S3", previous_rotation_id: previous }) as RotationRow;

const seats = [
  { rotation_id: "S2", table_id: "t2", party_id: "p2a" },
  { rotation_id: "S2", table_id: "t2", party_id: "p2b" },
  { rotation_id: "S1", table_id: "t1", party_id: "p1a" },
  { rotation_id: "S1", table_id: "t1", party_id: "p1b" },
  { rotation_id: "S0", table_id: "t0", party_id: "p0a" },
  { rotation_id: "S0", table_id: "t0", party_id: "p0b" },
];
const members = [
  { rotation_id: "S2", party_id: "p2a", profile_id: "ann" },
  { rotation_id: "S2", party_id: "p2a", profile_id: "al" },
  { rotation_id: "S2", party_id: "p2b", profile_id: "bea" },
  { rotation_id: "S1", party_id: "p1a", profile_id: "ann" },
  { rotation_id: "S1", party_id: "p1b", profile_id: "cy" },
  { rotation_id: "S0", party_id: "p0a", profile_id: "ann" },
  { rotation_id: "S0", party_id: "p0b", profile_id: "dee" },
];

describe("loadPastTables", () => {
  it("returns the two rotations before this one, each table as its parties' people, and nothing older", async () => {
    const { client } = fakeClient({ S2: "S1", S1: "S0", S0: null }, seats, members);
    expect(await loadPastTables(client, rotation("S2"))).toEqual([
      [["ann", "al"], ["bea"]],
      [["ann"], ["cy"]],
    ]);
  });

  it("stops at a rotation that is gone", async () => {
    const { client } = fakeClient({ S1: "S0", S0: null }, seats, members);
    expect(await loadPastTables(client, rotation("S2"))).toEqual([[["ann", "al"], ["bea"]]]);
  });

  it("reads nothing for a first rotation", async () => {
    const { client, read } = fakeClient({}, seats, members);
    expect(await loadPastTables(client, rotation(null))).toEqual([]);
    expect(read).toEqual([]);
  });

  it("returns null when a rotation or seat read fails", async () => {
    const chain = { S2: "S1", S1: "S0", S0: null };
    expect(await loadPastTables(fakeClient(chain, seats, members, "supper_rotations").client, rotation("S2"))).toBeNull();
    expect(await loadPastTables(fakeClient(chain, seats, members, "supper_seats").client, rotation("S2"))).toBeNull();
  });
});
