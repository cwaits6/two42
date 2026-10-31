import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  addLeader,
  leaderCandidates,
  leadersOf,
  removeLeader,
  type LeaderPerson,
  type LeaderRoster,
} from "./groupLeaders";

function person(id: string, first: string, last: string): LeaderPerson {
  return { id, first_name: first, last_name: last, preferred_name: null };
}

const ada = person("a", "Ada", "Lovelace");
const ben = person("b", "Ben", "Okafor");
const cy = person("c", "Cy", "Park");
const dee = person("d", "Dee", "Quinn");

const roster: LeaderRoster = {
  people: [ada, ben, cy, dee],
  roles: new Map([
    ["a", "leader"],
    ["c", "member"],
  ]),
};

describe("leadersOf", () => {
  it("lists only the group's leaders", () => {
    expect(leadersOf(roster)).toEqual([ada]);
  });
});

describe("leaderCandidates", () => {
  it("offers the group's members first, then the rest of the directory, never a current leader", () => {
    expect(leaderCandidates(roster, "")).toEqual([
      { person: cy, inGroup: true },
      { person: ben, inGroup: false },
      { person: dee, inGroup: false },
    ]);
  });

  it("narrows by name", () => {
    expect(leaderCandidates(roster, " okaf ")).toEqual([{ person: ben, inGroup: false }]);
    expect(leaderCandidates(roster, "ada")).toEqual([]);
  });
});

type Result = { data: { id: string }[] | null; error: { code: string; message: string } | null };

interface Calls {
  table?: string;
  update?: unknown;
  insert?: unknown;
  eq: [string, unknown][];
}

/** A stand-in for the browser client that records the one group_members write it sees. */
function client(result: Result) {
  const calls: Calls = { eq: [] };
  const filtered = {
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return filtered;
    },
    select: () => Promise.resolve(result),
  };
  const fake = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin" } } }) },
    from(table: string) {
      calls.table = table;
      return {
        update(values: unknown) {
          calls.update = values;
          return filtered;
        },
        insert(values: unknown) {
          calls.insert = values;
          return { select: () => Promise.resolve(result) };
        },
      };
    },
  };
  return { fake: fake as unknown as SupabaseClient<Database>, calls };
}

const ok: Result = { data: [{ id: "m1" }], error: null };
const none: Result = { data: [], error: null };

describe("addLeader", () => {
  it("promotes a current member in place", async () => {
    const { fake, calls } = client(ok);
    expect(await addLeader(fake, "g1", "c", true)).toBeNull();
    expect(calls.table).toBe("group_members");
    expect(calls.update).toEqual({ role: "leader" });
    expect(calls.eq).toEqual([
      ["group_id", "g1"],
      ["profile_id", "c"],
    ]);
  });

  it("adds someone from the directory to the group as a leader, leaving org_id to the database", async () => {
    const { fake, calls } = client(ok);
    expect(await addLeader(fake, "g1", "b", false)).toBeNull();
    expect(calls.insert).toEqual({ group_id: "g1", profile_id: "b", role: "leader", added_by: "admin" });
  });

  it("reports a write that touched no row as a failure", async () => {
    expect(await addLeader(client(none).fake, "g1", "c", true)).toMatch(/^Couldn't make them a leader/);
    expect(await addLeader(client(none).fake, "g1", "b", false)).toMatch(/^Couldn't add them as a leader/);
  });

  it("never shows the database's own error text", async () => {
    const failed: Result = { data: null, error: { code: "42501", message: "new row violates row-level security" } };
    const message = await addLeader(client(failed).fake, "g1", "b", false);
    expect(message).toMatch(/^Couldn't add them as a leader/);
    expect(message).not.toContain("row-level security");
  });

  it("says when the person joined the group in the meantime", async () => {
    const raced: Result = { data: null, error: { code: "23505", message: "duplicate key" } };
    expect(await addLeader(client(raced).fake, "g1", "b", false)).toMatch(/^They joined this group a moment ago/);
  });
});

describe("removeLeader", () => {
  it("keeps the person in the group as a member", async () => {
    const { fake, calls } = client(ok);
    expect(await removeLeader(fake, "g1", "a")).toBeNull();
    expect(calls.update).toEqual({ role: "member" });
    expect(calls.eq).toEqual([
      ["group_id", "g1"],
      ["profile_id", "a"],
      ["role", "leader"],
    ]);
  });

  it("reports a write that touched no row as a failure", async () => {
    expect(await removeLeader(client(none).fake, "g1", "a")).toMatch(/^Couldn't remove them as a leader/);
  });
});
