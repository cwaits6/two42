// Unit tests for the roster snapshot loader (CWA-40). Two things here are
// invisible to a reader and to CI's SQL lint: that every one of the six
// selects carries the org_id filter (the tier-C floor — a SupabaseClient
// PARAMETER is untyped as to privilege), and that a null-data/null-error
// response yields an empty roster, which planImport reads as "the org has no
// members" and turns every row into a create.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOrgSnapshot } from "@/lib/members/snapshot";
import type { Database } from "@/lib/supabase/database.types";

const TABLES = [
  "profiles",
  "family_units",
  "family_members",
  "member_groups",
  "profile_groups",
  "access_requests",
] as const;

type TableName = (typeof TABLES)[number];

function fakeClient(options: {
  data?: Partial<Record<TableName, unknown[] | null>>;
  errors?: Partial<Record<TableName, unknown>>;
}) {
  const filters = new Map<string, [string, unknown][]>();
  const client = {
    from(table: string) {
      const seen: [string, unknown][] = [];
      filters.set(table, seen);
      const chain = {
        select: () => chain,
        eq(column: string, value: unknown) {
          seen.push([column, value]);
          return chain;
        },
        // `in` rather than `?? []`: the stub has to distinguish "this test
        // said nothing about the table" from "this test explicitly returned
        // null". Collapsing them with `?? []` means an explicit null is
        // converted to [] HERE and loadOrgSnapshot never sees one, so the
        // null-data test below would pass against a snapshot.ts with its
        // `?? []` fallbacks deleted — the exact regression it exists to catch.
        order: () =>
          Promise.resolve({
            data:
              options.data && (table as TableName) in options.data
                ? options.data[table as TableName]
                : [],
            error: options.errors?.[table as TableName] ?? null,
          }),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, filters };
}

describe("loadOrgSnapshot", () => {
  it("filters every one of the six selects on org_id", async () => {
    const { client, filters } = fakeClient({});
    await loadOrgSnapshot(client, "org-7");
    for (const table of TABLES) {
      expect(filters.get(table)).toContainEqual(["org_id", "org-7"]);
    }
  });

  it.each(TABLES)("throws naming %s — and only the table — on its error", async (table) => {
    const { client } = fakeClient({ errors: { [table]: { message: "boom" } } });
    await expect(loadOrgSnapshot(client, "org-7")).rejects.toThrow(table);
  });

  it("never puts row content in the thrown message", async () => {
    const { client } = fakeClient({
      errors: {
        profiles: {
          message: "duplicate key",
          details: "Key (email)=(ada@example.com) already exists",
        },
      },
    });
    await expect(loadOrgSnapshot(client, "org-7")).rejects.toThrow(
      /^Failed to load profiles$/
    );
  });

  it("normalizes access request emails — the invite dedupe depends on it", async () => {
    const { client } = fakeClient({
      data: {
        access_requests: [
          { email: "  Ada@Example.ORG " },
          { email: "bob@example.org" },
        ],
      },
    });
    const snapshot = await loadOrgSnapshot(client, "org-7");
    expect(snapshot.accessRequestEmails).toEqual([
      "ada@example.org",
      "bob@example.org",
    ]);
  });

  it("treats null data with no error as an empty list", async () => {
    // { data: null, error: null } is a real PostgREST shape. planImport reads
    // an empty roster as "this org has no members" and plans a create for
    // every row, so the ?? [] fallbacks are load-bearing rather than defensive
    // noise.
    const { client } = fakeClient({
      data: Object.fromEntries(TABLES.map((t) => [t, null])),
    });
    const snapshot = await loadOrgSnapshot(client, "org-7");
    expect(snapshot).toEqual({
      profiles: [],
      families: [],
      familyMembers: [],
      groups: [],
      profileGroups: [],
      accessRequestEmails: [],
    });
  });

  it("issues all six queries concurrently, not in sequence", async () => {
    const started: string[] = [];
    let resolveAll: () => void = () => {};
    const gate = new Promise<void>((r) => {
      resolveAll = r;
    });
    const client = {
      from(table: string) {
        started.push(table);
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => gate.then(() => ({ data: [], error: null })),
        };
        return chain;
      },
    } as unknown as SupabaseClient<Database>;

    const pending = loadOrgSnapshot(client, "org-7");
    await vi.waitFor(() => expect(started).toHaveLength(6));
    resolveAll();
    await pending;
  });
});
