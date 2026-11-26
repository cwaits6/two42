// Unit tests for one church's refresh. Pure units: no network, no database —
// the fakes below satisfy RecordsRefreshClient and RecordsCopySource
// structurally and record every call.

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { refreshOrg, type RecordsRefreshClient, type RefreshOptions } from "../_shared/records-refresh.ts";
import type { RecordsCopyPerson, RecordsCopySource, RecordsPresence } from "../_shared/records-types.ts";
import { normalizePhone } from "../_shared/phone.ts";
import { logged } from "./logged.ts";

const ORG = "00000000-0000-0000-0000-0000000000aa";
const CONNECTION = "00000000-0000-0000-0000-0000000000cc";
const P1 = "00000000-0000-0000-0000-0000000000b1";
const P2 = "00000000-0000-0000-0000-0000000000b2";
const P3 = "00000000-0000-0000-0000-0000000000b3";
const P4 = "00000000-0000-0000-0000-0000000000b4";

interface Call {
  table: string;
  op: string;
  values?: unknown;
  filters: [string, ...unknown[]][];
}

interface Fixture {
  settings: { field: string; mode: string }[];
  claim: { cursor: string | null }[];
  states: Record<string, unknown>[];
  apply: (args: Record<string, unknown>) => { data: string | null; error: { message: string } | null };
}

function fakeDb(fixture: Fixture) {
  const calls: Call[] = [];
  const rpcs: Record<string, unknown>[] = [];
  const rows: Record<string, Record<string, unknown>[]> = {
    records_field_settings: fixture.settings,
    records_person_links: [
      { profile_id: P1, external_person_id: "100" },
      { profile_id: P2, external_person_id: "101" },
      { profile_id: P3, external_person_id: "102" },
      { profile_id: P4, external_person_id: "103" },
    ],
    records_person_state: fixture.states,
    profiles: [P1, P4].map((id) => ({ id, family_id: null, first_name: "Kept", last_name: "Name", phone_mobile: null })),
    family_units: [],
    family_members: [],
    records_field_values: [],
  };
  const chain = (call: Call) => {
    const self = {
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), self),
      in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), self),
      or: (f: string) => (call.filters.push(["or", f]), self),
      order: () => self,
      range: () => self,
      select: () => ((call.op = `${call.op}+select`), self),
      then(resolve: (r: unknown) => void) {
        if (call.op === "select") resolve({ data: rows[call.table] ?? [], error: null });
        else if (call.op === "update+select") resolve({ data: fixture.claim, error: null });
        else resolve({ error: null });
      },
    };
    return self;
  };
  const db = {
    from(table: string) {
      const start = (op: string, values?: unknown) => {
        const call: Call = { table, op, values, filters: [] };
        calls.push(call);
        return chain(call);
      };
      return {
        select: () => start("select"),
        update: (values: unknown) => start("update", values),
        upsert: (values: unknown) => start("upsert", values),
      };
    },
    rpc(_fn: string, args: Record<string, unknown>) {
      rpcs.push(args);
      return Promise.resolve(fixture.apply(args));
    },
  };
  return { db: db as unknown as RecordsRefreshClient, calls, rpcs };
}

const CHURCH: RecordsCopyPerson = {
  id: "100",
  firstName: "Zebulon",
  lastName: "Quux",
  nickName: "Zeb",
  title: null,
  suffix: null,
  gender: null,
  mobile: { countryCode: "1", number: "5125550123" },
  work: null,
  birthday: { month: null, day: null, year: null },
  anniversary: { month: null, day: null, year: null },
  graduationYear: null,
  photo: null,
};

function fakeSource() {
  const asked: { changedSince: (string | null)[]; peopleForCopy: string[][] } = { changedSince: [], peopleForCopy: [] };
  const source: RecordsCopySource = {
    changedSince(_creds, cursor) {
      asked.changedSince.push(cursor);
      return Promise.resolve({ ids: ["100", "999"], cursor: "2026-11-25T00:00:00" });
    },
    peopleForCopy(_creds, ids) {
      asked.peopleForCopy.push([...ids]);
      return Promise.resolve(ids.includes("100") ? [CHURCH] : []);
    },
    presence() {
      return Promise.resolve(
        new Map<string, RecordsPresence>([["100", "active"], ["101", "inactive"], ["103", "active"]]),
      );
    },
    photo: () => Promise.resolve(null),
  };
  return { source, asked };
}

function options(source: RecordsCopySource, over: Partial<RefreshOptions> = {}): RefreshOptions {
  return {
    orgId: ORG,
    connectionId: CONNECTION,
    creds: { baseUrl: "https://rock.example.org", key: "k" },
    source,
    normalizePhone,
    storePhoto: () => Promise.reject(new Error("no photo expected")),
    now: () => new Date("2026-11-26T03:00:00Z"),
    elapsed: () => 0,
    budgetMs: 60_000,
    ...over,
  };
}

const FIXTURE: Fixture = {
  settings: [{ field: "phone_mobile", mode: "member" }],
  claim: [{ cursor: "2026-11-20T00:00:00" }],
  states: [{ profile_id: P4, copied_at: "2026-11-21T00:00:00Z", review_reason: null, review_since: null }],
  apply: () => ({ data: "applied", error: null }),
};

function scopedToOrg(call: Call): boolean {
  if (call.op === "upsert") {
    const values = Array.isArray(call.values) ? call.values : [call.values];
    return values.every((v) => (v as { org_id?: string }).org_id === ORG);
  }
  return call.filters.some(([op, column, value]) => op === "eq" && column === "org_id" && value === ORG);
}

Deno.test("every read and write is bound to the church being refreshed", async () => {
  const { db, calls, rpcs } = fakeDb(FIXTURE);
  await refreshOrg(db, options(fakeSource().source));
  assert(calls.length > 5);
  for (const call of calls) assert(scopedToOrg(call), `${call.op} on ${call.table} has no org_id`);
  assert(rpcs.every((args) => args._org_id === ORG));
});

Deno.test("details are read only for people changed since the last run, and for links never copied", async () => {
  const { db, rpcs, calls } = fakeDb(FIXTURE);
  const { source, asked } = fakeSource();
  const result = await refreshOrg(db, options(source));
  assertEquals(asked.changedSince, ["2026-11-20T00:00:00"]);
  // 101 is inactive, 102 is gone and 103 was copied before and hasn't changed.
  assertEquals(asked.peopleForCopy, [["100"]]);
  assertEquals(rpcs.length, 1);
  assertEquals(rpcs[0]._profile_id, P1);
  assertEquals(rpcs[0]._profile, { phone_mobile: "+15125550123" });
  assertEquals(rpcs[0]._filled, true);
  assertEquals(result, { status: "done", copied: 1, pending: 0, review: 2, photosSkipped: 0, failed: 0, stoppedAtBudget: false });
  const release = calls.at(-1)!;
  assertEquals((release.values as { cursor: string }).cursor, "2026-11-25T00:00:00");
  assertEquals((release.values as { running_since: null }).running_since, null);
});

Deno.test("people who went inactive or can't be found are listed for review and left as they are", async () => {
  const { db, calls, rpcs } = fakeDb(FIXTURE);
  await refreshOrg(db, options(fakeSource().source));
  const review = calls.find((c) => c.table === "records_person_state" && c.op === "upsert")!;
  assertEquals(
    (review.values as { profile_id: string; review_reason: string }[]).map((r) => [r.profile_id, r.review_reason]),
    [[P2, "inactive"], [P3, "missing"]],
  );
  assertFalse(rpcs.some((args) => args._profile_id === P2 || args._profile_id === P3));
});

Deno.test("with every field not from the records, nobody is copied", async () => {
  const { db, rpcs } = fakeDb({ ...FIXTURE, settings: [] });
  const { source, asked } = fakeSource();
  const result = await refreshOrg(db, options(source));
  assertEquals(asked.peopleForCopy, []);
  assertEquals(rpcs, []);
  assertEquals(result.copied, 0);
});

Deno.test("a refresh already running stops this one before it reads anything", async () => {
  const { db, rpcs } = fakeDb({ ...FIXTURE, claim: [] });
  const { source, asked } = fakeSource();
  assertEquals((await refreshOrg(db, options(source))).status, "busy");
  assertEquals(asked.changedSince, []);
  assertEquals(rpcs, []);
});

Deno.test("a run cut short by its time keeps the mark, so nobody changed is skipped", async () => {
  const { db, calls, rpcs } = fakeDb(FIXTURE);
  const result = await refreshOrg(db, options(fakeSource().source, { elapsed: () => 60_000 }));
  assertEquals(rpcs, []);
  assertEquals(result.stoppedAtBudget, true);
  assertEquals(result.pending, 1);
  assertEquals((calls.at(-1)!.values as { cursor: string }).cursor, "2026-11-20T00:00:00");
});

Deno.test("a copy that finds the member's values changed meanwhile is tried in full next time", async () => {
  const { db, calls } = fakeDb({ ...FIXTURE, apply: () => ({ data: "stale", error: null }) });
  const result = await refreshOrg(db, options(fakeSource().source));
  assertEquals(result.pending, 1);
  const retry = calls.filter((c) => c.table === "records_person_state" && c.op === "upsert").at(-1)!;
  assertEquals(retry.values, [{ org_id: ORG, profile_id: P1, copied_at: null }]);
});

Deno.test("nothing read from the records reaches a log line", async () => {
  const lines = await logged(async () => {
    const { db } = fakeDb({ ...FIXTURE, apply: () => ({ data: null, error: { message: "Zebulon Quux +15125550123" } }) });
    const result = await refreshOrg(db, options(fakeSource().source));
    assertEquals(result.failed, 1);
  });
  assert(lines.length > 0);
  const text = JSON.stringify(lines);
  for (const value of ["Zebulon", "Quux", "Zeb", "5125550123", '"100"', "rock.example.org"]) {
    assertFalse(text.includes(value), `a log line carries ${value}`);
  }
});
