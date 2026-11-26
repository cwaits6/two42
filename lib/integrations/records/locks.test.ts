import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { lockedNameProfiles } from "./locks";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

// Applies the filters lockedNameProfiles sends, so a dropped org filter or a
// narrowed one shows up as a wrong set rather than passing against a canned answer.
function query(table: string) {
  const tests: ((row: Row) => boolean)[] = [];
  const rows = () => (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => (tests.push((row) => row[column] === value), chain),
    in: (column: string, values: unknown[]) => (tests.push((row) => values.includes(row[column])), chain),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null }),
  };
  return chain;
}
const client = { from: query } as unknown as SupabaseClient<Database>;

const ORG = "org-1";
const value = (profile_id: string, state: string, field = "name", org_id = ORG) => ({ org_id, profile_id, field, state });

beforeEach(() => {
  tables = {
    records_field_settings: [
      { org_id: ORG, field: "name", mode: "locked" },
      { org_id: "org-2", field: "name", mode: "locked" },
    ],
    records_field_values: [
      value("from-records", "records"),
      // The database keeps a locked name whatever the row's state.
      value("changed-before", "changed"),
      value("phone-only", "records", "phone_mobile"),
      value("other-church", "records", "name", "org-2"),
    ],
  };
});

describe("lockedNameProfiles", () => {
  it("lists everyone in the church with a name source while the name is locked", async () => {
    expect([...(await lockedNameProfiles(client, ORG))].sort()).toEqual(["changed-before", "from-records"]);
  });

  it("lists nobody while the name is member-changeable", async () => {
    tables.records_field_settings[0].mode = "member";
    expect((await lockedNameProfiles(client, ORG)).size).toBe(0);
  });

  it("lists nobody while the name isn't from the records, even when another church locks it", async () => {
    tables.records_field_settings = tables.records_field_settings.filter((row) => row.org_id !== ORG);
    expect((await lockedNameProfiles(client, ORG)).size).toBe(0);
  });
});
