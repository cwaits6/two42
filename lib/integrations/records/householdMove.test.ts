import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { loggedLines } from "@/lib/log/testing";
import { copyInFullAfterMove, dropAnniversarySourceBeforeMove } from "./householdMove";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let failing: Record<string, "error" | "throw">;
let order: string[];

// Applies the filters the helper sends, so a dropped org or person filter
// shows up as a wrong row touched rather than passing against a canned answer.
function query(table: string) {
  if (failing[table] === "throw") throw new Error("network");
  const tests: ((row: Row) => boolean)[] = [];
  let write: ((rows: Row[]) => void) | null = null;
  const chain = {
    delete: () => ((write = (rows) => (tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r)))), chain),
    update: (patch: Row) => ((write = (rows) => rows.forEach((r) => Object.assign(r, patch))), chain),
    eq: (column: string, value: unknown) => (tests.push((row) => row[column] === value), chain),
    not: (column: string, op: string, value: unknown) => {
      expect([op, value]).toEqual(["is", null]);
      tests.push((row) => row[column] !== null);
      return chain;
    },
    then: (resolve: (value: unknown) => void) => {
      order.push(table);
      if (failing[table] === "error") return resolve({ data: null, error: { code: "42501", message: "boom" } });
      write?.((tables[table] ?? []).filter((row) => tests.every((test) => test(row))));
      resolve({ data: null, error: null });
    },
  };
  return chain;
}
const client = { from: query } as unknown as SupabaseClient<Database>;

// UUIDs, as the log keeps only those in `ids`; the rows label them for reading.
const ORG = "11111111-1111-4111-8111-111111111111";
const MOVER = "22222222-2222-4222-8222-222222222222";
const label = (id: unknown) => (id === ORG ? "org-1" : id === MOVER ? "mover" : id);
const ROUTE = "/api/family-invites/join";
const source = (profile: string, field: string, state: string, org_id = ORG) => ({
  org_id,
  profile_id: profile === "mover" ? MOVER : profile,
  field,
  state,
});
const copied = (profile: string, org_id = ORG) => ({
  org_id,
  profile_id: profile === "mover" ? MOVER : profile,
  copied_at: "2026-11-01T00:00:00Z",
});

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  failing = {};
  order = [];
  tables = {
    records_field_values: [
      source("mover", "anniversary", "records"),
      source("mover", "birthday", "records"),
      source("spouse", "anniversary", "changed"),
      source("mover", "anniversary", "records", "org-2"),
    ],
    records_person_state: [copied("mover"), copied("spouse"), copied("mover", "org-2")],
  };
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

const fields = () => tables.records_field_values.map((r) => `${label(r.org_id)}:${label(r.profile_id)}:${r.field}`);
const copiedAt = () => tables.records_person_state.map((r) => `${label(r.org_id)}:${label(r.profile_id)}:${r.copied_at}`);

describe("dropAnniversarySourceBeforeMove", () => {
  it("drops only the mover's anniversary source", async () => {
    expect(await dropAnniversarySourceBeforeMove(client, ORG, MOVER, ROUTE)).toBe(true);

    expect(order).toEqual(["records_field_values"]);
    expect(fields()).toEqual(["org-1:mover:birthday", "org-1:spouse:anniversary", "org-2:mover:anniversary"]);
    expect(loggedLines(log)).toEqual([]);
  });

  it.each(["cleared", "changed"])("drops a %s anniversary source too", async (state) => {
    tables.records_field_values = [source("mover", "anniversary", state)];

    await dropAnniversarySourceBeforeMove(client, ORG, MOVER, ROUTE);

    expect(fields()).toEqual([]);
  });

  it("is true for someone with no source", async () => {
    expect(await dropAnniversarySourceBeforeMove(client, ORG, "not-linked", ROUTE)).toBe(true);
    expect(fields()).toHaveLength(4);
  });

  it.each(["error", "throw"] as const)("answers false and logs when the delete fails (%s)", async (how) => {
    failing.records_field_values = how;

    expect(await dropAnniversarySourceBeforeMove(client, ORG, MOVER, ROUTE)).toBe(false);

    expect(loggedLines(log)).toEqual([
      expect.objectContaining({ level: "error", route: ROUTE, step: "records_field_values", ids: { org: ORG, profile: MOVER } }),
    ]);
  });
});

describe("copyInFullAfterMove", () => {
  it("marks only the mover to be copied in full", async () => {
    await copyInFullAfterMove(client, ORG, MOVER, ROUTE);

    expect(copiedAt()).toEqual([
      "org-1:mover:null",
      "org-1:spouse:2026-11-01T00:00:00Z",
      "org-2:mover:2026-11-01T00:00:00Z",
    ]);
  });

  it("is harmless for someone never copied", async () => {
    await copyInFullAfterMove(client, ORG, "not-linked", ROUTE);

    expect(copiedAt()).toHaveLength(3);
    expect(loggedLines(log)).toEqual([]);
  });

  it.each(["error", "throw"] as const)("logs a failure (%s) without the error's text, and doesn't throw", async (how) => {
    failing.records_person_state = how;

    await expect(copyInFullAfterMove(client, ORG, MOVER, ROUTE)).resolves.toBeUndefined();

    const lines = loggedLines(log);
    expect(lines).toEqual([expect.objectContaining({ level: "error", step: "records_person_state" })]);
    expect(JSON.stringify(lines)).not.toContain("boom");
  });
});
