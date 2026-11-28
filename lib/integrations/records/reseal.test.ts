import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { intakeKeyLabel, openKey, type RecordsSecrets, sealKey } from "./crypto";
import { resealOrg } from "./reseal";

const current = randomBytes(32);
const previous = randomBytes(32);
const rotating: RecordsSecrets = { current, previous };
const afterRotation: RecordsSecrets = { current, previous: null };
const A = "org-a";
const B = "org-b";

type Row = { org_id: string; provider?: string; key_ciphertext: string };
interface Call {
  table: string;
  op: "select" | "update";
  filters: [string, string][];
}

// Applies the eq filters it is given, so a missing or wrong org predicate reads or writes nothing.
function stubClient(tables: Record<string, Row[]>, beforeUpdate?: () => void) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      let patch: Partial<Row> | null = null;
      const matching = () =>
        (tables[table] ?? []).filter((row) => call.filters.every(([col, value]) => row[col as keyof Row] === value));
      const builder = {
        select: () => builder,
        update(values: Partial<Row>) {
          call.op = "update";
          patch = values;
          return builder;
        },
        eq(col: string, value: string) {
          call.filters.push([col, value]);
          return builder;
        },
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then(resolve: (value: { data: Row[]; error: null }) => unknown) {
          beforeUpdate?.();
          const rows = matching();
          for (const row of rows) Object.assign(row, patch);
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

function churches() {
  const readA = sealKey({ current: previous, previous: null }, A, "rock", "read-key-a");
  const writeA = sealKey(rotating, A, intakeKeyLabel("rock"), "write-key-a");
  const readB = sealKey({ current: randomBytes(32), previous: null }, B, "rock", "read-key-b");
  return {
    tables: {
      records_connections: [
        { org_id: A, provider: "rock", key_ciphertext: readA },
        { org_id: B, provider: "rock", key_ciphertext: readB },
      ],
      records_intake_settings: [{ org_id: A, key_ciphertext: writeA }],
    } as Record<string, Row[]>,
    readA,
    writeA,
    readB,
  };
}

describe("re-sealing church records keys", () => {
  it("lists each sealed key by church and provider on a dry run, and writes nothing", async () => {
    const { tables, readA, writeA, readB } = churches();
    const { client, calls } = stubClient(tables);

    const results = [
      ...(await resealOrg(client, rotating, A, { apply: false })),
      ...(await resealOrg(client, rotating, B, { apply: false })),
    ];

    expect(results).toEqual([
      { orgId: A, provider: "rock", key: "read key", action: "reseal" },
      { orgId: A, provider: "rock", key: "write key", action: "noop" },
      { orgId: B, provider: "rock", key: "read key", action: "unopenable" },
    ]);
    expect(calls.some((c) => c.op === "update")).toBe(false);
    for (const call of calls) expect(call.filters).toContainEqual(["org_id", expect.stringMatching(/^org-[ab]$/)]);
    const printed = JSON.stringify(results);
    for (const secret of ["read-key-a", "write-key-a", "read-key-b", readA, writeA, readB]) {
      expect(printed).not.toContain(secret);
    }
    expect(tables.records_connections[0].key_ciphertext).toBe(readA);
  });

  it("re-seals under the current secret with --apply, so the key opens once the previous one is removed", async () => {
    const { tables, readA } = churches();
    const { client, calls } = stubClient(tables);

    const results = await resealOrg(client, rotating, A, { apply: true });

    expect(results[0]).toEqual({ orgId: A, provider: "rock", key: "read key", action: "reseal", outcome: "resealed" });
    expect(results[1]).toEqual({ orgId: A, provider: "rock", key: "write key", action: "noop" });
    expect(openKey(afterRotation, A, "rock", tables.records_connections[0].key_ciphertext)).toBe("read-key-a");
    const updates = calls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: "records_connections" });
    expect(updates[0].filters).toEqual([
      ["org_id", A],
      ["key_ciphertext", readA],
    ]);

    const again = await resealOrg(client, afterRotation, A, { apply: false });
    expect(again.map((r) => r.action)).toEqual(["noop", "noop"]);
  });

  it("leaves a key a church admin replaced after the read alone", async () => {
    const { tables } = churches();
    const replaced = sealKey(afterRotation, A, "rock", "entered-meanwhile");
    const { client } = stubClient(tables, () => {
      tables.records_connections[0].key_ciphertext = replaced;
    });

    const [read] = await resealOrg(client, rotating, A, { apply: true });

    expect(read.outcome).toBe("changed meanwhile");
    expect(tables.records_connections[0].key_ciphertext).toBe(replaced);
  });

  it("reports a church with no keys as having none", async () => {
    const { client } = stubClient({ records_connections: [], records_intake_settings: [] });
    expect(await resealOrg(client, rotating, A, { apply: true })).toEqual([]);
  });
});
