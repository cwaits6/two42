// Unit tests for the write executor (CWA-40). applyWrites already took the
// Supabase client as a parameter, so a recording fake is enough to assert the
// thing a reviewer cannot see by reading: which table each write kind hits,
// which columns it filters on, and what the failure accounting reports. A
// wrong .eq() here flips is_leader on the wrong row or silently no-ops, and
// a no-op is indistinguishable from success without these.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyWrites, redactFailure } from "@/lib/members/apply";
import type { Database } from "@/lib/supabase/database.types";
import type { PlannedWrite } from "@/lib/members/import-plan";

interface Call {
  table: string;
  op: "insert" | "update" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
}

/** Per-table scripted outcome: undefined = success. */
type Failures = Record<string, unknown>;

function fakeClient(options: { failures?: Failures; insertedId?: string } = {}) {
  const calls: Call[] = [];
  const failures = options.failures ?? {};

  const builder = (table: string, op: Call["op"], payload?: unknown) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    const error = failures[table] ?? null;
    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      select() {
        return chain;
      },
      single() {
        return Promise.resolve({
          data: error ? null : { id: options.insertedId ?? "new-family" },
          error,
        });
      },
      // Awaiting the builder without .single() resolves to { error }.
      then(resolve: (value: { error: unknown }) => unknown) {
        return Promise.resolve(resolve({ error }));
      },
    };
    return chain;
  };

  const client = {
    from(table: string) {
      return {
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        delete: () => builder(table, "delete"),
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

const ORG = "org-1";
const USER = "user-1";

describe("applyWrites — write routing", () => {
  it("inserts a household, then links its family member by the per-file key", async () => {
    // The familyIdByKey hand-off is the one place the plan's ORDERING is
    // load-bearing: the member insert has no family_id of its own.
    const { client, calls } = fakeClient({ insertedId: "f-new" });
    const writes: PlannedWrite[] = [
      {
        kind: "insert_family_unit",
        line: 1,
        householdKey: "hh-1",
        values: { family_name: "Zeta Family" },
      },
      {
        kind: "insert_family_member",
        line: 1,
        familyId: null,
        householdKey: "hh-1",
        values: { first_name: "Zeb", relationship: "primary" },
      },
    ];
    const result = await applyWrites(client, USER, ORG, writes);
    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({ table: "family_units", op: "insert" });
    expect(calls[1]).toMatchObject({
      table: "family_members",
      op: "insert",
      payload: { first_name: "Zeb", relationship: "primary", family_id: "f-new" },
    });
  });

  it("prefers an existing familyId over the per-file key", async () => {
    const { client, calls } = fakeClient();
    await applyWrites(client, USER, ORG, [
      {
        kind: "insert_family_member",
        line: 1,
        familyId: "f-existing",
        householdKey: null,
        values: { first_name: "Zoe", relationship: "child" },
      },
    ]);
    expect(calls[0].payload).toMatchObject({ family_id: "f-existing" });
  });

  it("fails the write when a household key resolves no family id", async () => {
    // Reachable only if the plan's ordering is broken — which is exactly why
    // it must be a recorded failure and not an insert with family_id
    // undefined.
    const { client } = fakeClient();
    const result = await applyWrites(client, USER, ORG, [
      {
        kind: "insert_family_member",
        line: 4,
        familyId: null,
        householdKey: "never-inserted",
        values: { first_name: "Ghost", relationship: "other" },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failedAtLine).toBe(4);
  });

  it("scopes every update and delete on org_id as well as its row key", async () => {
    // The tier-C floor: these address rows by id, so without the org filter
    // the tenant boundary would be RLS alone on a client this signature
    // cannot prove is request-scoped.
    const { client, calls } = fakeClient();
    await applyWrites(client, USER, ORG, [
      { kind: "update_profile", line: 1, id: "p1", values: { city: "Austin" } },
      {
        kind: "update_family_member",
        line: 2,
        id: "m1",
        values: { relationship: "child" },
      },
      {
        kind: "update_profile_group",
        line: 3,
        profileId: "p1",
        groupId: "g1",
        isLeader: true,
      },
      {
        kind: "delete_profile_group",
        line: 4,
        profileId: "p1",
        groupId: "g2",
      },
    ]);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["org_id", ORG]);
    }
    expect(calls[0].filters).toContainEqual(["id", "p1"]);
    expect(calls[2].filters).toContainEqual(["profile_id", "p1"]);
    expect(calls[2].filters).toContainEqual(["group_id", "g1"]);
    expect(calls[3]).toMatchObject({ table: "profile_groups", op: "delete" });
  });

  it("stamps assigned_by on a group assignment and carries is_leader", async () => {
    const { client, calls } = fakeClient();
    await applyWrites(client, USER, ORG, [
      {
        kind: "insert_profile_group",
        line: 1,
        profileId: "p1",
        groupId: "g1",
        isLeader: true,
      },
    ]);
    expect(calls[0].payload).toEqual({
      profile_id: "p1",
      group_id: "g1",
      is_leader: true,
      assigned_by: USER,
    });
  });

  it("carries no org_id in any insert payload — the column DEFAULT resolves it", async () => {
    const { client, calls } = fakeClient();
    await applyWrites(client, USER, ORG, [
      {
        kind: "insert_family_unit",
        line: 1,
        householdKey: "hh-1",
        values: { family_name: "Zeta" },
      },
      {
        kind: "insert_profile_group",
        line: 2,
        profileId: "p1",
        groupId: "g1",
        isLeader: false,
      },
    ]);
    for (const call of calls.filter((c) => c.op === "insert")) {
      expect(JSON.stringify(call.payload)).not.toContain("org_id");
    }
  });
});

describe("applyWrites — failure accounting", () => {
  const spread: PlannedWrite[] = [
    { kind: "update_profile", line: 1, id: "p1", values: { city: "A" } },
    {
      kind: "insert_profile_group",
      line: 1,
      profileId: "p1",
      groupId: "g1",
      isLeader: false,
    },
    { kind: "update_profile", line: 2, id: "p2", values: { city: "B" } },
    {
      kind: "update_family_member",
      line: 3,
      id: "m1",
      values: { relationship: "child" },
    },
  ];

  it("reports the CSV line and kind that failed, not just a write index", async () => {
    // `failedAt` alone indexes a write list the client never sees, and one
    // CSV row commonly produces 3–5 writes.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      failures: { family_members: { code: "23503", message: "fk violation" } },
    });
    const result = await applyWrites(client, USER, ORG, spread);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failedAt).toBe(4);
    expect(result.failedAtLine).toBe(3);
    expect(result.failedKind).toBe("update_family_member");
    expect(result.applied).toBe(3);
  });

  it("lists only the lines whose EVERY write landed", async () => {
    // This is what makes a manual retry safe: the admin deletes these lines
    // and re-uploads. A half-written line must never appear here.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      failures: { profile_groups: { code: "23505", message: "duplicate" } },
    });
    const result = await applyWrites(client, USER, ORG, spread);
    expect(result.ok).toBe(false);
    // Write 1 (line 1) landed but write 2 (line 1) failed, so line 1 is NOT
    // complete — and lines 2 and 3 were never reached.
    expect(result.ok === false && result.appliedLines).toEqual([]);
  });

  it("reports every line on success", async () => {
    const { client } = fakeClient();
    const result = await applyWrites(client, USER, ORG, spread);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.appliedLines).toEqual([1, 2, 3]);
    expect(result.applied).toBe(4);
  });

  it("treats a thrown error as a failure instead of losing the accounting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      from() {
        throw new TypeError("fetch failed");
      },
    } as unknown as SupabaseClient<Database>;
    const result = await applyWrites(client, USER, ORG, [
      { kind: "update_profile", line: 7, id: "p1", values: { city: "A" } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failedAtLine).toBe(7);
  });

  it("logs the line, kind, and constraint identity — never the payload", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      failures: {
        profiles: {
          code: "23505",
          message: "duplicate key value violates unique constraint",
          details: "Key (email, org_id)=(ada@example.com, org-1) already exists",
          hint: null,
        },
      },
    });
    await applyWrites(client, USER, ORG, [
      {
        kind: "update_profile",
        line: 9,
        id: "p1",
        values: { city: "Springfield" },
      },
    ]);
    const logged = spy.mock.calls[0].join(" ");
    expect(logged).not.toContain("ada@example.com");
    expect(logged).not.toContain("Springfield");
  });
});

describe("redactFailure", () => {
  it("drops details and hint for a Postgres error — they echo the row", () => {
    const out = redactFailure({
      code: "23505",
      message: "duplicate key",
      details: "Key (email, org_id)=(ada@example.com, org-1) already exists",
      hint: "consider a different value",
    });
    expect(out).toContain("23505");
    expect(out).toContain("duplicate key");
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("consider a different value");
  });

  it("KEEPS details for a client-side network error, which has no SQLSTATE", () => {
    // postgrest-js synthesizes these with code: '' and the whole diagnostic
    // in details. It has never seen a row value — and this is the failure
    // mode most likely to hit production mid-apply.
    const out = redactFailure({
      code: "",
      message: "TypeError: fetch failed",
      details: "getaddrinfo ENOTFOUND db.example.supabase.co",
      hint: "",
    });
    expect(out).toContain("ENOTFOUND");
  });

  it("KEEPS hint for a PGRST error, where it names the fix", () => {
    const out = redactFailure({
      code: "PGRST204",
      message: "Column not found in the schema cache",
      details: null,
      hint: "Perhaps you meant 'first_name'",
    });
    expect(out).toContain("first_name");
  });

  it("falls back to the message for a plain Error", () => {
    expect(redactFailure(new Error("boom"))).toBe("boom");
  });

  it("never throws on an unrecognised value", () => {
    expect(redactFailure(null)).toBe("unknown error");
    expect(redactFailure("a string")).toBe("unknown error");
  });
});
