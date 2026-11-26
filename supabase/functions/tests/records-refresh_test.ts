// Unit tests for one church's refresh. Pure units: no network, no database —
// the fakes below satisfy RecordsRefreshClient and RecordsCopySource
// structurally and record every call.

import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import { refreshAllOrgs, refreshOrg, type RecordsRefreshClient, type RefreshOptions } from "../_shared/records-refresh.ts";
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
  values?: Record<string, unknown>[];
  familyMembers?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
  familyUnits?: Record<string, unknown>[];
  releaseFails?: boolean;
  /** Unlinked after the refresh read its links: their state row fails the link foreign key. */
  unlinked?: string;
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
    profiles: fixture.profiles ??
      [P1, P4].map((id) => ({ id, family_id: null, first_name: "Kept", last_name: "Name", phone_mobile: null })),
    family_units: fixture.familyUnits ?? [],
    family_members: fixture.familyMembers ?? [],
    records_field_values: fixture.values ?? [],
  };
  const chain = (call: Call) => {
    const self = {
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), self),
      in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), self),
      or: (f: string) => (call.filters.push(["or", f]), self),
      order: (c: string) => (call.filters.push(["order", c]), self),
      range: () => self,
      select: () => ((call.op = `${call.op}+select`), self),
      then(resolve: (r: unknown) => void) {
        if (call.op === "select") resolve({ data: structuredClone(rows[call.table] ?? []), error: null });
        else if (call.op === "update+select") resolve({ data: fixture.claim, error: null });
        else if (
          call.op === "upsert" && call.table === "records_person_state" && fixture.unlinked &&
          (call.values as { profile_id: string }[]).some((v) => v.profile_id === fixture.unlinked)
        ) {
          rows.records_person_links = rows.records_person_links.filter((l) => l.profile_id !== fixture.unlinked);
          resolve({ error: { message: "violates foreign key constraint", code: "23503" } });
        } else if (call.op === "update" && call.table === "records_refresh_state" && fixture.releaseFails) {
          resolve({ error: { message: "release refused" } });
        } else resolve({ error: null });
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
  return { db: db as unknown as RecordsRefreshClient, calls, rpcs, rows };
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
    removePhoto: () => Promise.reject(new Error("no photo removal expected")),
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

Deno.test("people still waiting for a copy go before people copied already and changed again", async () => {
  const { db, rpcs } = fakeDb({
    ...FIXTURE,
    states: [
      { profile_id: P1, copied_at: "2026-11-21T00:00:00Z", review_reason: null, review_since: null },
      { profile_id: P4, copied_at: null, review_reason: null, review_since: null },
    ],
  });
  const { source, asked } = fakeSource();
  await refreshOrg(db, options(source));
  assertEquals(asked.peopleForCopy, [["103", "100"]]);
  // The copy names the person it was read from, so a link changed meanwhile isn't written.
  assertEquals(rpcs.map((args) => (args._expected as { person: string }).person), ["100"]);
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
  assertEquals(rpcs[0]._filled, ["phone_mobile"]);
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

Deno.test("someone unlinked while the refresh runs is left out of its writes, and the others are still written", async () => {
  const { db, calls } = fakeDb({ ...FIXTURE, unlinked: P3 });
  const result = await refreshOrg(db, options(fakeSource().source));
  assertEquals(result.status, "done");
  const reviews = calls.filter((c) => c.table === "records_person_state" && c.op === "upsert");
  assertEquals(
    (reviews.at(-1)!.values as { profile_id: string }[]).map((r) => r.profile_id),
    [P2],
  );
});

Deno.test("the copy is handed the state each copied field had when it was read", async () => {
  const cleared = { profile_id: P1, field: "phone_mobile", state: "cleared", church_value: { phone_mobile: null } };
  const { db, rpcs } = fakeDb({ ...FIXTURE, settings: [{ field: "phone_mobile", mode: "member" }, { field: "gender", mode: "member" }], values: [cleared] });
  await refreshOrg(db, options(fakeSource().source));
  assertEquals((rpcs[0]._expected as { states: unknown }).states, { phone_mobile: "cleared", gender: null });
});

Deno.test("with name copied, the copy is also handed the preferred name's state", async () => {
  const cleared = { profile_id: P1, field: "preferred_name", state: "cleared", church_value: { preferred_name: null } };
  const { db, rpcs } = fakeDb({ ...FIXTURE, settings: [{ field: "name", mode: "member" }], values: [cleared] });
  await refreshOrg(db, options(fakeSource().source));
  assertEquals((rpcs[0]._expected as { states: unknown }).states, { name: null, preferred_name: "cleared" });
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

Deno.test("a run cut short by its time keeps the last refresh time, counts who it didn't reach and marks them to copy next", async () => {
  const { db, calls, rpcs } = fakeDb({ ...FIXTURE, states: [] });
  const result = await refreshOrg(db, options(fakeSource().source, { elapsed: () => 60_000 }));
  assertEquals(rpcs, []);
  assertEquals(result.stoppedAtBudget, true);
  // P1 changed and P4 never copied: both due, neither reached.
  assertEquals(result.pending, 2);
  const marked = calls.filter((c) => c.table === "records_person_state" && c.op === "upsert").at(-1)!;
  assertEquals(marked.values, [P1, P4].map((id) => ({ org_id: ORG, profile_id: id, copied_at: null })));
  assertEquals(calls.at(-1)!.values, { cursor: "2026-11-25T00:00:00", running_since: null });
});

Deno.test("runs cut short carry on where the last one stopped until the whole change set is copied", async () => {
  const copied = (id: string) => ({ profile_id: id, copied_at: "2026-11-21T00:00:00Z", review_reason: null, review_since: null });
  const marks = ["2026-11-25T00:00:00", "2026-11-26T00:00:00"];
  const sourceFor = (changed: string[], cursor: string) => {
    const { source, asked } = fakeSource();
    const run: RecordsCopySource = {
      ...source,
      changedSince: (_creds, since) => (asked.changedSince.push(since), Promise.resolve({ ids: changed, cursor })),
      peopleForCopy: (_creds, ids) => Promise.resolve(ids.map((id) => ({ ...CHURCH, id }))),
    };
    return { run, asked };
  };
  // The time runs out after the first person: the batch's check and P1's pass, P4's doesn't.
  let checks = 0;
  const first = fakeDb({ ...FIXTURE, states: [copied(P1), copied(P4)] });
  const one = sourceFor(["100", "103"], marks[0]);
  const cut = await refreshOrg(first.db, options(one.run, { elapsed: () => (++checks > 2 ? 60_000 : 0) }));
  assertEquals(first.rpcs.map((args) => args._profile_id), [P1]);
  assertEquals(cut.stoppedAtBudget, true);
  const marked = first.calls.filter((c) => c.table === "records_person_state" && c.op === "upsert").at(-1)!;
  const release = first.calls.at(-1)!.values as Record<string, unknown>;
  assertEquals(release, { cursor: marks[0], running_since: null });

  // Nothing else changed since; the second run copies only who the first didn't reach, and finishes.
  const second = fakeDb({
    ...FIXTURE,
    claim: [{ cursor: release.cursor as string }],
    states: [copied(P1), ...(marked.values as Record<string, unknown>[]).map((row) => ({ ...copied(row.profile_id as string), ...row }))],
  });
  const two = sourceFor([], marks[1]);
  const done = await refreshOrg(second.db, options(two.run));
  assertEquals(two.asked.changedSince, [marks[0]]);
  assertEquals(second.rpcs.map((args) => args._profile_id), [P4]);
  assertEquals(done.stoppedAtBudget, false);
  assertEquals(done.pending, 0);
  const finished = second.calls.at(-1)!.values as Record<string, unknown>;
  assertEquals(finished.cursor, marks[1]);
  assert(finished.last_refreshed_at);
});

Deno.test("someone copied before who changed and wasn't reached in time is still to copy", async () => {
  const copied = (id: string) => ({ profile_id: id, copied_at: "2026-11-21T00:00:00Z", review_reason: null, review_since: null });
  const { db } = fakeDb({ ...FIXTURE, states: [copied(P1), copied(P4)] });
  const result = await refreshOrg(db, options(fakeSource().source, { elapsed: () => 60_000 }));
  assertEquals(result.pending, 1);
});

Deno.test("a copy that finds the member's values changed meanwhile is tried in full next time", async () => {
  const { db, calls } = fakeDb({ ...FIXTURE, apply: () => ({ data: "stale", error: null }) });
  const result = await refreshOrg(db, options(fakeSource().source));
  assertEquals(result.pending, 1);
  const retry = calls.filter((c) => c.table === "records_person_state" && c.op === "upsert").at(-1)!;
  assertEquals(retry.values, [{ org_id: ORG, profile_id: P1, copied_at: null }]);
});

Deno.test("nothing read from the records reaches a log line", async () => {
  let result: Awaited<ReturnType<typeof refreshOrg>> | undefined;
  const lines = await logged(async () => {
    const { db } = fakeDb({ ...FIXTURE, apply: () => ({ data: null, error: { message: "Zebulon Quux +15125550123" } }) });
    result = await refreshOrg(db, options(fakeSource().source));
  });
  assertEquals(result?.failed, 1);
  assert(lines.length > 0);
  const text = JSON.stringify(lines);
  for (const value of ["Zebulon", "Quux", "Zeb", "5125550123", '"100"', "rock.example.org"]) {
    assertFalse(text.includes(value), `a log line carries ${value}`);
  }
});

Deno.test("a value the member cleared is handed to the copy and stays cleared", async () => {
  const cleared = { profile_id: P1, field: "phone_mobile", state: "cleared", church_value: { phone_mobile: "+15125550123" } };
  const { db, rpcs } = fakeDb({ ...FIXTURE, values: [cleared] });
  await refreshOrg(db, options(fakeSource().source));
  assertEquals(rpcs.length, 1);
  assertEquals(rpcs[0]._profile, {});
  assertEquals(rpcs[0]._filled, []);
  assertEquals(
    (rpcs[0]._values as { field: string; state: string }[]).find((v) => v.field === "phone_mobile")?.state,
    "cleared",
  );
});

Deno.test("a failed run keeps the last refresh time and releases its claim", async () => {
  const { db, calls } = fakeDb(FIXTURE);
  const { source } = fakeSource();
  const failing = { ...source, presence: () => Promise.reject(new Error("records down")) };
  await assertRejects(() => refreshOrg(db, options(failing)), Error, "records down");
  const release = calls.at(-1)!;
  assertEquals(release.table, "records_refresh_state");
  assertEquals(release.values, { running_since: null });
});

Deno.test("a release that also fails doesn't hide why the run failed", async () => {
  const { db } = fakeDb({ ...FIXTURE, releaseFails: true });
  const { source } = fakeSource();
  const failing = { ...source, presence: () => Promise.reject(new Error("records down")) };
  await assertRejects(() => refreshOrg(db, options(failing)), Error, "records down");
});

Deno.test("a photo the records couldn't give right now puts the person back for the next run", async () => {
  const { db, calls, rpcs } = fakeDb({ ...FIXTURE, settings: [{ field: "photo", mode: "member" }] });
  const { source } = fakeSource();
  const withPhoto: RecordsCopySource = {
    ...source,
    peopleForCopy: () => Promise.resolve([{ ...CHURCH, photo: "77" }]),
    photo: () => Promise.reject(new Error("timed out")),
  };
  const result = await refreshOrg(db, options(withPhoto));
  assertEquals(rpcs, []);
  assertEquals(result.failed, 1);
  const retry = calls.filter((c) => c.table === "records_person_state" && c.op === "upsert").at(-1)!;
  assertEquals(retry.values, [{ org_id: ORG, profile_id: P1, copied_at: null }]);
});

Deno.test("a photo stored for someone deleted while their copy ran is removed again", async () => {
  const { db } = fakeDb({ ...FIXTURE, settings: [{ field: "photo", mode: "member" }], apply: () => ({ data: "gone", error: null }) });
  const { source } = fakeSource();
  const withPhoto: RecordsCopySource = {
    ...source,
    peopleForCopy: () => Promise.resolve([{ ...CHURCH, photo: "77" }]),
    photo: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff])),
  };
  const removed: string[] = [];
  await refreshOrg(db, options(withPhoto, {
    storePhoto: (_org, profileId) => Promise.resolve(`https://storage.example/${profileId}.jpg`),
    removePhoto: (orgId, profileId) => (removed.push(`${orgId}/${profileId}`), Promise.resolve()),
  }));
  assertEquals(removed, [`${ORG}/${P1}`]);
});

Deno.test("with two household rows for one person, the copy works from the first, as the database writes it", async () => {
  const { db, rpcs, calls } = fakeDb({
    ...FIXTURE,
    settings: [{ field: "grade", mode: "member" }],
    familyMembers: [
      { id: "fm-1", claimed_profile_id: P1, graduation_year: 2031 },
      { id: "fm-2", claimed_profile_id: P1, graduation_year: 2029 },
    ],
  });
  await refreshOrg(db, options(fakeSource().source));
  assertEquals((rpcs[0]._expected as { grade: unknown }).grade, { graduation_year: 2031 });
  // The fake returns rows as listed, so the order asked for is what makes the first row the first.
  const read = calls.find((c) => c.table === "family_members" && c.op === "select")!;
  assert(read.filters.some(([op, column]) => op === "order" && column === "id"));
});

Deno.test("two linked spouses copied in one batch both get their copy, the second against the anniversary the first wrote", async () => {
  const HOME = "00000000-0000-0000-0000-0000000000f1";
  const empty = { anniversary_month: null, anniversary_day: null, anniversary_year: null };
  const spouse = (id: string) => ({ id, family_id: HOME, first_name: "Kept", last_name: "Name", phone_mobile: null });
  const fixture: Fixture = {
    ...FIXTURE,
    settings: [{ field: "phone_mobile", mode: "member" }, { field: "anniversary", mode: "member" }],
    states: [],
    profiles: [spouse(P1), spouse(P4)],
    familyUnits: [{ id: HOME, ...empty }],
    apply: (args) => {
      // As records_apply_copy() does: stale unless the household still holds what the copy expected.
      const home = rows.family_units[0];
      const expected = (args._expected as { household: Record<string, unknown> }).household;
      if (Object.entries(expected).some(([column, value]) => home[column] !== value)) return { data: "stale", error: null };
      Object.assign(home, args._household as object);
      return { data: "applied", error: null };
    },
  };
  const { db, rpcs, rows } = fakeDb(fixture);
  const { source } = fakeSource();
  const married = { ...CHURCH, anniversary: { month: 6, day: 14, year: 2001 } };
  const both: RecordsCopySource = {
    ...source,
    peopleForCopy: () => Promise.resolve([married, { ...married, id: "103", mobile: { countryCode: "1", number: "5125550199" } }]),
  };
  const result = await refreshOrg(db, options(both));
  assertEquals(rpcs.map((args) => args._profile_id), [P1, P4]);
  assertEquals(result.copied, 2);
  assertEquals(result.pending, 0);
  assertEquals((rpcs[1]._expected as { household: unknown }).household, {
    anniversary_month: 6,
    anniversary_day: 14,
    anniversary_year: 2001,
  });
  assertEquals(rpcs[1]._profile, { phone_mobile: "+15125550199" });
});

Deno.test("a copy whose anniversary was held for the household counts only what it wrote", async () => {
  const HOME = "00000000-0000-0000-0000-0000000000f1";
  const empty = { anniversary_month: null, anniversary_day: null, anniversary_year: null };
  const { db, rpcs } = fakeDb({
    ...FIXTURE,
    settings: [{ field: "anniversary", mode: "member" }],
    states: [],
    profiles: [{ id: P1, family_id: HOME, first_name: "Kept", last_name: "Name", phone_mobile: null }],
    familyUnits: [{ id: HOME, ...empty }],
    apply: () => ({ data: "held", error: null }),
  });
  const { source } = fakeSource();
  const married = { ...CHURCH, anniversary: { month: 6, day: 14, year: 2001 } };
  const result = await refreshOrg(db, { ...options({ ...source, peopleForCopy: () => Promise.resolve([married]) }) });
  assertEquals(rpcs.length, 1);
  assertEquals(rpcs[0]._filled, ["anniversary"]);
  assertEquals(result.copied, 0);
  assertEquals(result.failed, 0);
  assertEquals(result.pending, 0);
});

Deno.test("a copy whose anniversary was held still counts the person's own writes", async () => {
  const HOME = "00000000-0000-0000-0000-0000000000f1";
  const empty = { anniversary_month: null, anniversary_day: null, anniversary_year: null };
  const { db, rpcs } = fakeDb({
    ...FIXTURE,
    settings: [{ field: "anniversary", mode: "member" }, { field: "phone_mobile", mode: "member" }],
    states: [],
    profiles: [{ id: P1, family_id: HOME, first_name: "Kept", last_name: "Name", phone_mobile: null }],
    familyUnits: [{ id: HOME, ...empty }],
    apply: () => ({ data: "held", error: null }),
  });
  const { source } = fakeSource();
  const married = { ...CHURCH, anniversary: { month: 6, day: 14, year: 2001 } };
  const result = await refreshOrg(db, { ...options({ ...source, peopleForCopy: () => Promise.resolve([married]) }) });
  assertEquals(rpcs[0]._profile, { phone_mobile: "+15125550123" });
  assertEquals(result.copied, 1);
});

Deno.test("the nightly run shares one budget: a church reached after it is spent isn't started, and any unfinished or held church fails the run", async () => {
  const org = (n: number) => ({ id: `org-${n}`, name: "", timezone: "UTC", branding: null, org_email_domains: [] });
  const done = (over: Partial<Awaited<ReturnType<typeof refreshOrg>>> = {}) => ({
    status: "done" as const, copied: 1, pending: 0, review: 0, photosSkipped: 0, failed: 0, stoppedAtBudget: false, ...over,
  });
  let clock = 0;
  const started: string[] = [];
  const all = await refreshAllOrgs([org(1), org(2), org(3)], {
    elapsed: () => clock,
    budgetMs: 60_000,
    refreshOne: (o) => {
      started.push(o.id);
      // The second church spends the rest of the time and is cut short.
      if (o.id === "org-2") {
        clock = 60_000;
        return Promise.resolve(done({ copied: 2, pending: 3, stoppedAtBudget: true }));
      }
      return Promise.resolve(done());
    },
  });
  assertEquals(started, ["org-1", "org-2"]);
  assertEquals(all.cutShort, ["org-2"]);
  assertEquals(all.notStarted, ["org-3"]);
  assertEquals([all.connected, all.copied, all.pending], [2, 3, 3]);
  assertFalse(all.finished);

  const clean = await refreshAllOrgs([org(1), org(2)], {
    elapsed: () => 0,
    budgetMs: 60_000,
    refreshOne: (o) => Promise.resolve(o.id === "org-1" ? null : done()),
  });
  assertEquals(clean.connected, 1);
  assert(clean.finished);

  // A church another refresh holds was not refreshed by this run.
  const held = await refreshAllOrgs([org(1), org(2)], {
    elapsed: () => 0,
    budgetMs: 60_000,
    refreshOne: (o) => Promise.resolve(o.id === "org-1" ? done({ status: "busy", copied: 0 }) : done()),
  });
  assertEquals(held.busy, ["org-1"]);
  assertEquals([held.connected, held.copied], [1, 1]);
  assertFalse(held.finished);

  // People whose copy failed are copied again next run, but the run says so.
  const partial = await refreshAllOrgs([org(1), org(2)], {
    elapsed: () => 0,
    budgetMs: 60_000,
    refreshOne: (o) => Promise.resolve(o.id === "org-2" ? done({ failed: 2, pending: 2 }) : done()),
  });
  assertEquals(partial.copyFailed, ["org-2"]);
  assertFalse(partial.finished);

  // A later turn starts further in, so the church after a slow one gets the time first.
  const order: string[] = [];
  await refreshAllOrgs([org(1), org(2), org(3)], {
    elapsed: () => 0,
    budgetMs: 60_000,
    turn: 4,
    refreshOne: (o) => {
      order.push(o.id);
      return Promise.resolve(done());
    },
  });
  assertEquals(order, ["org-2", "org-3", "org-1"]);

  let broken: Awaited<ReturnType<typeof refreshAllOrgs>> | undefined;
  const lines = await logged(async () => {
    broken = await refreshAllOrgs([org(1)], {
      elapsed: () => 0,
      budgetMs: 60_000,
      refreshOne: () => Promise.reject(new Error("records connection read failed")),
    });
  });
  assertEquals(broken?.failed, ["org-1"]);
  assertFalse(broken?.finished);
  assert(lines.length > 0);
});
