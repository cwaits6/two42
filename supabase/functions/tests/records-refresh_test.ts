// Unit tests for one church's refresh. Pure units: no network, no database —
// the fakes below satisfy RecordsRefreshClient and RecordsCopySource
// structurally and record every call.

import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import { refreshAllOrgs, refreshOrg, type RecordsRefreshClient, type RefreshOptions } from "../_shared/records-refresh.ts";
import type {
  RecordsCopyPerson,
  RecordsCopySource,
  RecordsFamily,
  RecordsHouseholdSource,
  RecordsPresence,
} from "../_shared/records-types.ts";
import { RecordsError } from "../_shared/records-errors.ts";
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
  orgSettings?: Record<string, unknown>[];
  householdLinks?: Record<string, unknown>[];
  householdValues?: Record<string, unknown>[];
  householdAnniversaries?: Record<string, unknown>[];
  childSuggestions?: Record<string, unknown>[];
  /** Rows an update that returns its rows answers with, by table. */
  updated?: Record<string, Record<string, unknown>[]>;
}

function fakeDb(fixture: Fixture) {
  const calls: Call[] = [];
  const rpcs: Record<string, unknown>[] = [];
  const fns: string[] = [];
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
    records_org_settings: fixture.orgSettings ?? [],
    records_household_links: fixture.householdLinks ?? [],
    records_household_values: fixture.householdValues ?? [],
    records_household_anniversary: fixture.householdAnniversaries ?? [],
    records_child_suggestions: fixture.childSuggestions ?? [],
  };
  const chain = (call: Call) => {
    const self = {
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), self),
      in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), self),
      is: (c: string, v: unknown) => (call.filters.push(["is", c, v]), self),
      or: (f: string) => (call.filters.push(["or", f]), self),
      order: (c: string) => (call.filters.push(["order", c]), self),
      range: () => self,
      select: () => ((call.op = `${call.op}+select`), self),
      then(resolve: (r: unknown) => void) {
        if (call.op === "select") resolve({ data: structuredClone(rows[call.table] ?? []), error: null });
        else if (call.op === "update+select") {
          resolve({
            data: call.table === "records_refresh_state" ? fixture.claim : fixture.updated?.[call.table] ?? [],
            error: null,
          });
        }
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
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push(args);
      fns.push(fn);
      return Promise.resolve(fixture.apply({ ...args, fn }));
    },
  };
  return { db: db as unknown as RecordsRefreshClient, calls, rpcs, fns, rows };
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
    storeChildPhoto: () => Promise.reject(new Error("no child photo expected")),
    removeChildPhoto: () => Promise.reject(new Error("no child photo removal expected")),
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
  assertEquals(result, {
    status: "done",
    copied: 1,
    pending: 0,
    review: 2,
    photosSkipped: 0,
    failed: 0,
    stoppedAtBudget: false,
    householdsCopied: 0,
    householdsUnavailable: false,
  });
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

Deno.test("a household step that fails keeps the people's mark but not the refresh time", async () => {
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    apply: (args) =>
      args.fn === "records_replace_household_suggestions"
        ? { data: null, error: { message: "households refused" } }
        : HOUSEHOLD_FIXTURE.apply(args),
  });
  await assertRejects(() => refreshOrg(db, options(householdSource().source)), Error, "households refused");
  const release = calls.at(-1)!;
  assertEquals(release.table, "records_refresh_state");
  assertEquals(release.values, { cursor: "2026-11-25T00:00:00", running_since: null });
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
      const source = (args._values as { field: string; state: string; church_value: unknown }[])
        .find((v) => v.field === "anniversary");
      if (source) rows.records_household_anniversary = [{ family_id: HOME, state: source.state, church_value: source.church_value }];
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
  const second = rpcs[1]._expected as { states: Record<string, unknown>; anniversaries: Record<string, unknown> };
  assertEquals(second.states.anniversary, "records", "the second spouse plans on the household's source the first copy wrote");
  assertEquals(Object.keys(second.anniversaries).sort(), [P1, P4]);
});

Deno.test("the anniversary is planned on the records of every linked person in the household, in the batch or not", async () => {
  const HOME = "00000000-0000-0000-0000-0000000000f1";
  const empty = { anniversary_month: null, anniversary_day: null, anniversary_year: null };
  const housed = (id: string) => ({ id, family_id: HOME, first_name: "Kept", last_name: "Name", phone_mobile: null });
  const { db, rpcs } = fakeDb({
    ...FIXTURE,
    settings: [{ field: "anniversary", mode: "member" }, { field: "phone_mobile", mode: "member" }],
    states: [{ profile_id: P4, copied_at: "2026-11-21T00:00:00Z", review_reason: null, review_since: null }],
    profiles: [housed(P1), housed(P3), { id: P4, family_id: null, first_name: "Kept", last_name: "Name", phone_mobile: null }],
    familyUnits: [{ id: HOME, ...empty }],
  });
  const { source, asked } = fakeSource();
  const spouse = { ...CHURCH, id: "102", anniversary: { month: 7, day: 2, year: 1999 } };
  const result = await refreshOrg(db, options({
    ...source,
    peopleForCopy: (creds, ids) => {
      asked.peopleForCopy.push([...ids]);
      return Promise.resolve([{ ...CHURCH, anniversary: { month: 6, day: 14, year: 2001 } }, spouse]);
    },
  }));
  assertEquals(rpcs.map((args) => args._profile_id), [P1]);
  assertEquals(asked.peopleForCopy, [["100", "102"]]);
  assertEquals((rpcs[0]._expected as { anniversaries: unknown }).anniversaries, {
    [P1]: { anniversary_month: 6, anniversary_day: 14, anniversary_year: 2001 },
    [P3]: { anniversary_month: 7, anniversary_day: 2, anniversary_year: 1999 },
  });
  assertEquals(rpcs[0]._household, {}, "the spouses' records differ, so nothing writes the anniversary");
  assertFalse((rpcs[0]._values as { field: string }[]).some((v) => v.field === "anniversary"));
  assertEquals(rpcs[0]._filled, ["phone_mobile"]);
  assertEquals(result.copied, 1);
});

Deno.test("the anniversary's state is the household's source, never a person's own old row", async () => {
  const HOME = "00000000-0000-0000-0000-0000000000f1";
  const { db, rpcs } = fakeDb({
    ...FIXTURE,
    settings: [{ field: "anniversary", mode: "member" }],
    states: [],
    profiles: [{ id: P1, family_id: HOME, first_name: "Kept", last_name: "Name", phone_mobile: null }],
    familyUnits: [{ id: HOME, anniversary_month: null, anniversary_day: null, anniversary_year: null }],
    values: [{ profile_id: P1, field: "anniversary", state: "records", church_value: {} }],
    householdAnniversaries: [{ family_id: HOME, state: "cleared", church_value: {} }],
  });
  const { source } = fakeSource();
  const married = { ...CHURCH, anniversary: { month: 6, day: 14, year: 2001 } };
  await refreshOrg(db, options({ ...source, peopleForCopy: () => Promise.resolve([married]) }));
  assertEquals((rpcs[0]._expected as { states: Record<string, unknown> }).states, { anniversary: "cleared" });
  assertEquals(rpcs[0]._household, {}, "the household cleared it, so it stays empty");
  assertEquals(rpcs[0]._values, [
    { field: "anniversary", state: "cleared", church_value: { anniversary_month: 6, anniversary_day: 14, anniversary_year: 2001 } },
  ]);
});

Deno.test("someone with no household sends no anniversary reads", async () => {
  const { db, rpcs } = fakeDb({ ...FIXTURE, settings: [{ field: "anniversary", mode: "member" }] });
  await refreshOrg(db, options(fakeSource().source));
  assertEquals(rpcs.length, 1);
  assertFalse("anniversaries" in (rpcs[0]._expected as object));
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
    status: "done" as const, copied: 1, pending: 0, review: 0, photosSkipped: 0, failed: 0, stoppedAtBudget: false,
    householdsCopied: 0, householdsUnavailable: false, ...over,
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

const H1 = "00000000-0000-0000-0000-00000000f001";
const H2 = "00000000-0000-0000-0000-00000000f002";
const MEMBER = "00000000-0000-0000-0000-00000000e001";

const FAMILY: RecordsFamily = {
  id: "500",
  members: [{ id: "100", adult: true, married: true }, { id: "103", adult: true, married: true }],
  children: [{ id: "900", firstName: "Lily", lastName: "Quux", birthday: { month: 3, day: 3 }, graduationYear: 2034, photo: "7" }],
  address: { street1: "12 Oak St", street2: "", city: "Austin", state: "TX", postalCode: "78701", country: "US" },
  homePhone: { countryCode: "1", number: "5125550122" },
};

function householdSource(over: Partial<RecordsHouseholdSource> = {}) {
  const asked: { children: boolean[] } = { children: [] };
  const households: RecordsHouseholdSource = {
    familyOf: () => Promise.resolve(new Map([["100", "500"], ["103", "500"]])),
    families: (_creds, ids, options) => {
      asked.children.push(options.children);
      return Promise.resolve(ids.includes("500") ? [FAMILY] : []);
    },
    ...over,
  };
  const { source } = fakeSource();
  return { source: { ...source, households }, asked };
}

const HOUSEHOLD_FIXTURE: Fixture = {
  ...FIXTURE,
  settings: [{ field: "phone_mobile", mode: "member" }, { field: "address", mode: "member" }],
  profiles: [
    { id: P1, family_id: H1, relationship: "primary", role: "member", first_name: "Kept", last_name: "Name", phone_mobile: null },
    { id: P4, family_id: H2, relationship: "primary", role: "member", first_name: "Also", last_name: "Name", phone_mobile: null },
  ],
  familyUnits: [
    { id: H1, created_at: "2026-01-01", address_line1: null, address_line2: null, city: null, state: null, postal_code: null, phone_home: null, phone_profile_id: null },
    { id: H2, created_at: "2026-02-01", address_line1: null, address_line2: null, city: null, state: null, postal_code: null, phone_home: null, phone_profile_id: null },
  ],
  apply: () => ({ data: "applied", error: null }),
};

Deno.test("every household read and write is bound to the church being refreshed", async () => {
  const { db, calls, rpcs, fns } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    orgSettings: [{ suggest_children: true }],
    householdLinks: [{ family_id: H1, external_family_id: "500" }],
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }],
    updated: { family_members: [{ id: MEMBER }] },
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  await refreshOrg(db, options(source, { storeChildPhoto: () => Promise.resolve("https://storage/child.jpg") }));
  for (const call of calls) assert(scopedToOrg(call), `${call.op} on ${call.table} has no org_id`);
  assert(rpcs.every((args) => args._org_id === ORG));
  assert(fns.includes("records_replace_household_suggestions"));
  assert(fns.includes("records_apply_household_copy"));
  assert(fns.includes("records_sync_child_suggestions"));
});

Deno.test("no refresh changes a household's people: groupings are only stored as suggestions", async () => {
  const { db, calls, rpcs, fns } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    householdLinks: [{ family_id: H1, external_family_id: "500" }],
  });
  await refreshOrg(db, options(householdSource().source));
  assertFalse(calls.some((c) => c.table === "profiles" && c.op !== "select"));
  assertFalse(calls.some((c) => c.table === "family_units" && c.op !== "select"));
  assertFalse(fns.includes("records_confirm_household"));
  const replace = rpcs[fns.indexOf("records_replace_household_suggestions")];
  // P4 is in H2, so joining H1 is a suggestion to check first.
  assertEquals(replace._suggestions, [{
    external_family_id: "500",
    target_family_id: H1,
    family_name: null,
    people: [{ profile_id: P4, from_family_id: H2, from_relationship: "primary", relationship: "spouse" }],
    basis: [
      { profile_id: P1, external_person_id: "100", family_id: H1 },
      { profile_id: P4, external_person_id: "103", family_id: H2 },
    ],
    ready: false,
  }]);
  // The linked household's address is filled through the copy's own check, bound to this refresh's connection.
  const apply = rpcs[fns.indexOf("records_apply_household_copy")];
  assertEquals(apply._connection_id, CONNECTION);
  assertEquals((apply._household as Record<string, unknown>).address_line1, "12 Oak St");
  assertEquals((apply._expected as { family: string }).family, "500");
  // Home phone is off in the field settings, so the family's home phone isn't copied or tracked.
  assertFalse("phone_home" in (apply._household as Record<string, unknown>));
  assertEquals((apply._values as { field: string }[]).map((v) => v.field), ["address"]);
});

Deno.test("a refresh cut short before every family was read keeps the last suggestions", async () => {
  const { db, fns } = fakeDb(HOUSEHOLD_FIXTURE);
  let spent = 0;
  const { source } = householdSource({
    familyOf: () => {
      spent = 100_000;
      return Promise.resolve(new Map([["100", "500"]]));
    },
  });
  const result = await refreshOrg(db, options(source, { elapsed: () => spent }));
  assertFalse(fns.includes("records_replace_household_suggestions"));
  assertEquals(result.householdsCopied, 0);
  assertEquals(result.stoppedAtBudget, true);
});

Deno.test("a refresh whose time runs out on the last person copied reads no families and hasn't finished", async () => {
  let spent = 0;
  let familiesAsked = false;
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    apply: () => {
      spent = 100_000;
      return { data: "applied", error: null };
    },
  });
  const { source } = householdSource({
    familyOf: () => {
      familiesAsked = true;
      return Promise.resolve(new Map());
    },
  });
  const result = await refreshOrg(db, options(source, { elapsed: () => spent }));
  assertEquals(result.copied, 1);
  assertEquals(result.stoppedAtBudget, true);
  assertFalse(familiesAsked);
  const release = calls.filter((c) => c.table === "records_refresh_state" && c.op === "update").at(-1)!;
  assertFalse("last_counts" in (release.values as Record<string, unknown>));
});

Deno.test("a refresh cut short before a linked household's address was copied hasn't finished", async () => {
  let spent = 0;
  const { db, calls, fns } = fakeDb({ ...HOUSEHOLD_FIXTURE, householdLinks: [{ family_id: H1, external_family_id: "500" }] });
  const { source } = householdSource({
    families: () => {
      spent = 100_000;
      return Promise.resolve([FAMILY]);
    },
  });
  const result = await refreshOrg(db, options(source, { elapsed: () => spent }));
  assertEquals(result.stoppedAtBudget, true);
  assertFalse(fns.includes("records_apply_household_copy"));
  const release = calls.filter((c) => c.table === "records_refresh_state" && c.op === "update").at(-1)!;
  assertFalse("last_counts" in (release.values as Record<string, unknown>));
});

Deno.test("a refresh cut short at an added child's photo hasn't finished", async () => {
  let spent = 0;
  const { db, calls } = fakeDb({ ...HOUSEHOLD_FIXTURE, childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }] });
  const { source } = householdSource({
    families: () => {
      spent = 100_000;
      return Promise.resolve([FAMILY]);
    },
  });
  source.photo = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  const result = await refreshOrg(db, options(source, { elapsed: () => spent }));
  assertEquals(result.stoppedAtBudget, true);
  assertFalse(calls.some((c) => c.table === "records_child_suggestions" && c.op === "update"));
});

Deno.test("records that can't be reached while reading families fail the run instead of blaming the key", async () => {
  const { db, calls } = fakeDb(HOUSEHOLD_FIXTURE);
  const { source } = householdSource({ familyOf: () => Promise.reject(new RecordsError("unreachable")) });
  let thrown: unknown;
  await logged(() => refreshOrg(db, options(source)).catch((err) => void (thrown = err)));
  assert(thrown instanceof RecordsError);
  const release = calls.filter((c) => c.table === "records_refresh_state" && c.op === "update").at(-1)!;
  assertEquals((release.values as { running_since: null }).running_since, null);
  assertFalse("last_counts" in (release.values as Record<string, unknown>));
});

Deno.test("with the children switch off, no child is asked for or suggested", async () => {
  const { db, fns } = fakeDb({ ...HOUSEHOLD_FIXTURE, householdLinks: [{ family_id: H1, external_family_id: "500" }] });
  const { source, asked } = householdSource();
  await refreshOrg(db, options(source));
  assertEquals(asked.children, [false]);
  assertFalse(fns.includes("records_sync_child_suggestions"));
});

Deno.test("with the switch on, a linked household's children are suggested without a birth year", async () => {
  const { db, fns, rpcs } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    orgSettings: [{ suggest_children: true }],
    householdLinks: [{ family_id: H1, external_family_id: "500" }],
  });
  const { source, asked } = householdSource();
  await refreshOrg(db, options(source));
  assertEquals(asked.children, [true]);
  const sync = rpcs[fns.indexOf("records_sync_child_suggestions")];
  assertEquals(sync._connection_id, CONNECTION);
  assertEquals(sync._children, [{
    external_person_id: "900",
    first_name: "Lily",
    last_name: "Quux",
    birth_month: 3,
    birth_day: 3,
    graduation_year: 2034,
    photo: "7",
  }]);
});

for (const mode of ["copy", "live"] as const) {
  Deno.test(`in ${mode} mode a refresh ${mode === "live" ? "stores no" : "stores the"} birthday, anniversary, grade and address from the records, and copies the rest`, async () => {
    const { db, fns, rpcs } = fakeDb({
      ...HOUSEHOLD_FIXTURE,
      settings: ["name", "phone_mobile", "birthday", "anniversary", "grade", "address", "phone_home"].map((field) => ({
        field,
        mode: "member",
      })),
      orgSettings: [{ suggest_children: true, mode }],
      householdLinks: [{ family_id: H1, external_family_id: "500" }],
      familyMembers: [{ id: MEMBER, claimed_profile_id: P1, graduation_year: null }],
      familyUnits: HOUSEHOLD_FIXTURE.familyUnits!.map((unit) => ({
        ...unit,
        anniversary_month: null,
        anniversary_day: null,
        anniversary_year: null,
      })),
    });
    const { source } = householdSource();
    source.peopleForCopy = (_creds, ids) =>
      Promise.resolve(
        ids.includes("100")
          ? [{
            ...CHURCH,
            birthday: { month: 4, day: 5, year: 1980 },
            anniversary: { month: 6, day: 7, year: 2001 },
            graduationYear: 2030,
          }]
          : [],
      );
    await refreshOrg(db, options(source));

    const liveOnly = /^(birth_|anniversary_|graduation_year$|address_line|city$|state$|postal_code$)/;
    const of = (fn: string) => rpcs.filter((_, i) => fns[i] === fn) as Record<string, unknown>[];
    const people = of("records_apply_copy");
    const households = of("records_apply_household_copy");
    const children = of("records_sync_child_suggestions");
    assert(people.length > 0 && households.length > 0 && children.length > 0);
    const columns = [
      ...people.flatMap((a) => [a._profile, a._household, a._grade].flatMap((c) => Object.keys(c as object))),
      ...households.flatMap((a) => Object.keys(a._household as object)),
    ];
    const fields = [...people, ...households].flatMap((a) => (a._values as { field: string }[]).map((v) => v.field));
    const childDetails = children.flatMap((a) =>
      (a._children as Record<string, unknown>[]).flatMap((c) => [c.birth_month, c.birth_day, c.graduation_year])
    );
    assert(columns.includes("phone_mobile") && columns.includes("phone_home"));
    assert(fields.includes("phone_mobile") && fields.includes("phone_home"));
    assertEquals(children.flatMap((a) => (a._children as { first_name: string }[]).map((c) => c.first_name)), ["Lily"]);
    if (mode === "live") {
      assertEquals(columns.filter((c) => liveOnly.test(c)), []);
      assertEquals(fields.filter((f) => ["birthday", "anniversary", "grade", "address"].includes(f)), []);
      assertEquals(childDetails, [null, null, null]);
    } else {
      assert(columns.includes("birth_month") && columns.includes("anniversary_month") && columns.includes("address_line1"));
      assert(columns.includes("graduation_year"));
      assertEquals(childDetails, [3, 3, 2034]);
    }
  });
}

Deno.test("a household entry another child was added as doesn't hide a same-named child", async () => {
  const lily = { id: MEMBER, family_id: H1, first_name: "Lily", last_name: "Quux" };
  const sync = async (childSuggestions: Record<string, unknown>[]) => {
    const { db, fns, rpcs } = fakeDb({
      ...HOUSEHOLD_FIXTURE,
      orgSettings: [{ suggest_children: true }],
      householdLinks: [{ family_id: H1, external_family_id: "500" }],
      familyMembers: [lily],
      childSuggestions,
    });
    await refreshOrg(db, options(householdSource().source));
    return (rpcs[fns.indexOf("records_sync_child_suggestions")]._children as { external_person_id: string }[])
      .map((c) => c.external_person_id);
  };
  assertEquals(await sync([]), []);
  assertEquals(await sync([{ id: "c1", family_member_id: MEMBER, external_person_id: "901", photo: null }]), ["900"]);
});

Deno.test("a key that can't read families still copies people, releases its claim and says so", async () => {
  const { db, calls, fns } = fakeDb(HOUSEHOLD_FIXTURE);
  const { source } = householdSource({ familyOf: () => Promise.reject(new RecordsError("unauthorized", 401)) });
  let result: Awaited<ReturnType<typeof refreshOrg>> | undefined;
  const lines = await logged(async () => {
    result = await refreshOrg(db, options(source));
  });
  assertEquals(result?.householdsUnavailable, true);
  assertEquals(result?.copied, 1);
  assert(fns.includes("records_apply_copy"));
  assertFalse(fns.includes("records_replace_household_suggestions"));
  const release = calls.filter((c) => c.table === "records_refresh_state" && c.op === "update").at(-1)!;
  assertEquals((release.values as { running_since: null }).running_since, null);
  assertEquals((release.values as { last_counts: Record<string, number> }).last_counts.householdsUnavailable, 1);
  const text = JSON.stringify(lines);
  for (const fromRecords of ["Zebulon", "Quux", "500", "Oak", "5125550122"]) assert(!text.includes(fromRecords), fromRecords);
});

Deno.test("an added child's photo fills an empty photo only, and the token is let go once the photo is placed or removed", async () => {
  const stored: string[] = [];
  const removed: string[] = [];
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }, { id: "c2", family_member_id: null, photo: null }],
    updated: { family_members: [] },
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  await refreshOrg(db, options(source, {
    storeChildPhoto: (_org, id) => (stored.push(id), Promise.resolve("https://storage/child.jpg")),
    removeChildPhoto: (_org, id) => (removed.push(id), Promise.resolve()),
  }));
  assertEquals(stored, [MEMBER]);
  // The household gave the child its own photo meanwhile, so the church's is removed again.
  assertEquals(removed, [MEMBER]);
  const write = calls.find((c) => c.table === "family_members" && c.op === "update+select")!;
  assert(write.filters.some(([op, column]) => op === "is" && column === "avatar_url"));
  const cleared = calls.filter((c) => c.table === "records_child_suggestions" && c.op === "update");
  assertEquals(cleared.map((c) => c.filters.find(([, column]) => column === "id")?.[2]), ["c1"]);
});

Deno.test("an unused child photo that couldn't be removed keeps its token for the next run", async () => {
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }],
    familyMembers: [{ id: MEMBER, avatar_url: "https://storage/own.jpg" }],
    updated: { family_members: [] },
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  const attempts: string[] = [];
  let run: ReturnType<typeof refreshOrg> | undefined;
  await logged(async () => {
    run = refreshOrg(db, options(source, {
      storeChildPhoto: () => Promise.resolve("https://storage/child.jpg"),
      removeChildPhoto: (_org, id) => (attempts.push(id), Promise.reject(new Error("storage down"))),
    }));
    await run.catch(() => {});
  });
  // Awaited outside the log capture, so a refresh that threw fails here.
  await run;
  assertEquals(attempts, [MEMBER]);
  assertFalse(calls.some((c) => c.table === "records_child_suggestions" && c.op === "update"));
});

Deno.test("when the records no longer give a child's photo, one stored earlier and not shown is removed before the token goes", async () => {
  const removed: string[] = [];
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }],
    familyMembers: [{ id: MEMBER, avatar_url: "https://storage/own.jpg" }],
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(null);
  await refreshOrg(db, options(source, { removeChildPhoto: (_org, id) => (removed.push(id), Promise.resolve()) }));
  assertEquals(removed, [MEMBER]);
  const cleared = calls.filter((c) => c.table === "records_child_suggestions" && c.op === "update");
  assertEquals(cleared.map((c) => c.filters.find(([, column]) => column === "id")?.[2]), ["c1"]);
});

Deno.test("when the records no longer give a child's photo, one the child shows is kept", async () => {
  const removed: string[] = [];
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }],
    familyMembers: [{ id: MEMBER, avatar_url: `https://storage/avatars/org/family-members/${MEMBER}/records-photo.jpg` }],
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(null);
  await refreshOrg(db, options(source, { removeChildPhoto: (_org, id) => (removed.push(id), Promise.resolve()) }));
  assertEquals(removed, []);
  assert(calls.some((c) => c.table === "records_child_suggestions" && c.op === "update"));
});

Deno.test("a retried child photo already in place is kept", async () => {
  const removed: string[] = [];
  const { db, calls } = fakeDb({
    ...HOUSEHOLD_FIXTURE,
    childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }],
    familyMembers: [{ id: MEMBER, avatar_url: "https://storage/child.jpg" }],
    updated: { family_members: [] },
  });
  const { source } = householdSource();
  source.photo = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0x00]));
  await refreshOrg(db, options(source, {
    storeChildPhoto: () => Promise.resolve("https://storage/child.jpg"),
    removeChildPhoto: (_org, id) => (removed.push(id), Promise.resolve()),
  }));
  assertEquals(removed, []);
  const cleared = calls.filter((c) => c.table === "records_child_suggestions" && c.op === "update");
  assertEquals(cleared.map((c) => c.filters.find(([, column]) => column === "id")?.[2]), ["c1"]);
});

Deno.test("a child's photo the records can't give right now is tried again next time", async () => {
  const { db, calls } = fakeDb({ ...HOUSEHOLD_FIXTURE, childSuggestions: [{ id: "c1", family_member_id: MEMBER, photo: "7" }] });
  const { source } = householdSource();
  source.photo = () => Promise.reject(new RecordsError("unreachable"));
  await refreshOrg(db, options(source));
  assertFalse(calls.some((c) => c.table === "records_child_suggestions" && c.op === "update"));
});
