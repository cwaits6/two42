// The cleanup against an in-memory table set: the fake evaluates the filters the
// real chains build, so each test asserts which rows survive and what count was
// reported, at the boundary and across churches.

import { assertEquals } from "jsr:@std/assert@1";
import {
  cleanUpOrg,
  cleanUpOrgs,
  type CleanupClient,
  DELETE_BATCH,
  summarizeCleanup,
} from "../_shared/cleanup.ts";

type Row = Record<string, unknown>;
type Predicate = (row: Row) => boolean;

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-11-03T09:00:00.000Z");

const EXPIRED_CUTOFF = "2026-08-05T09:00:00.000Z";
const JUST_PAST_EXPIRED = "2026-08-05T08:59:59.999Z";
const FEEDBACK_CUTOFF = "2025-11-03T09:00:00.000Z";
const JUST_PAST_FEEDBACK = "2025-11-03T08:59:59.999Z";
const SIX_MONTH_CUTOFF = "2026-05-03T09:00:00.000Z";
const JUST_PAST_SIX_MONTHS = "2026-05-03T08:59:59.999Z";
const REMINDER_CUTOFF = "2026-09-29";
const JUST_PAST_REMINDERS = "2026-09-28";

interface FakeOptions {
  /** Tables whose deletes answer with an error. */
  failDelete?: readonly string[];
  /** Tables whose reads answer with an error. */
  failRead?: readonly string[];
  /** Tables whose deletes succeed with no count. */
  nullCount?: readonly string[];
  /** Tables whose reads return fewer rows than their count. */
  truncateRead?: readonly string[];
  /** Limits failDelete to this church. */
  failOnlyOrg?: string;
}

function fakeClient(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  const queries: Array<{ table: string; op: string; filters: string[] }> = [];

  function chain(table: string, op: "delete" | "select") {
    const predicates: Predicate[] = [];
    const filters: string[] = [];
    let limitTo: number | null = null;
    const add = (label: string, predicate: Predicate) => {
      filters.push(label);
      predicates.push(predicate);
      return builder;
    };
    const matching = () => (tables[table] ?? []).filter((row) => predicates.every((p) => p(row)));

    function settle() {
      queries.push({ table, op, filters });
      if (op === "delete") {
        const failsHere = !options.failOnlyOrg ||
          filters.includes(`eq org_id=${options.failOnlyOrg}`);
        if (options.failDelete?.includes(table) && failsHere) {
          return { count: null, error: { message: `${table} delete refused` } };
        }
        const doomed = matching().slice(0, limitTo ?? undefined);
        tables[table] = (tables[table] ?? []).filter((row) => !doomed.includes(row));
        return { count: options.nullCount?.includes(table) ? null : doomed.length, error: null };
      }
      if (options.failRead?.includes(table)) {
        return { data: null, count: null, error: { message: `${table} read refused` } };
      }
      const rows = matching();
      return {
        data: options.truncateRead?.includes(table) ? rows.slice(1) : rows,
        count: rows.length,
        error: null,
      };
    }

    const builder = {
      eq: (column: string, value: unknown) =>
        add(`eq ${column}=${value}`, (row) => row[column] === value),
      is: (column: string, value: null) =>
        add(`is ${column}=${value}`, (row) => row[column] === null),
      lt: (column: string, value: string) =>
        add(`lt ${column}=${value}`, (row) =>
          typeof row[column] === "string" &&
          new Date(row[column] as string).getTime() < new Date(value).getTime()),
      not: (column: string, operator: string, value: unknown) => {
        if (operator === "is") {
          return add(`not ${column} is null`, (row) => row[column] !== null);
        }
        const excluded = String(value).slice(1, -1).split(",");
        return add(`not ${column} in ${value}`, (row) => !excluded.includes(String(row[column])));
      },
      order: () => builder,
      limit: (count: number) => {
        limitTo = count;
        return builder;
      },
      maybeSingle: () => {
        const settled = settle() as { data?: Row[] | null; error: unknown };
        return Promise.resolve({ data: settled.data?.[0] ?? null, error: settled.error });
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(settle()).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    from: (table: string) => ({
      delete: () => chain(table, "delete"),
      select: () => chain(table, "select"),
    }),
  } as unknown as CleanupClient;
  return { client, tables, queries };
}

function ids(rows: Row[] | undefined): string[] {
  return (rows ?? []).map((row) => row.id as string).sort();
}

function org(months: number | null = null, id = ORG): Row {
  return { id, prayer_request_retention_months: months };
}

Deno.test("access_requests: only declined and unused expired rows past 90 days go", async () => {
  const base = {
    org_id: ORG,
    status: "approved",
    reviewed_at: null,
    approved_role: null,
    signup_token: null,
    token_expires_at: null,
    invite_token: null,
  };
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [
      { ...base, id: "denied-past", status: "denied", reviewed_at: JUST_PAST_EXPIRED },
      { ...base, id: "denied-on-cutoff", status: "denied", reviewed_at: EXPIRED_CUTOFF },
      { ...base, id: "denied-unreviewed", status: "denied" },
      { ...base, id: "pending-ancient", status: "pending", reviewed_at: "2020-01-01T00:00:00.000Z" },
      { ...base, id: "expired-past", signup_token: "t1", token_expires_at: JUST_PAST_EXPIRED },
      { ...base, id: "expired-on-cutoff", signup_token: "t2", token_expires_at: EXPIRED_CUTOFF },
      { ...base, id: "consumed", signup_token: null, token_expires_at: JUST_PAST_EXPIRED },
      {
        ...base,
        id: "founding-admin",
        approved_role: "admin",
        signup_token: "t3",
        token_expires_at: JUST_PAST_EXPIRED,
      },
      { ...base, id: "no-expiry", signup_token: "t4", token_expires_at: null },
    ],
  });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed.accessRequests, 2);
  assertEquals(ids(tables.access_requests), [
    "consumed",
    "denied-on-cutoff",
    "denied-unreviewed",
    "expired-on-cutoff",
    "founding-admin",
    "no-expiry",
    "pending-ancient",
  ]);
});

Deno.test("family_invites: unaccepted past 90 days from sent_at, else created_at", async () => {
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [],
    family_invites: [
      { id: "sent-past", org_id: ORG, token: "a", accepted_at: null, sent_at: JUST_PAST_EXPIRED, created_at: JUST_PAST_EXPIRED },
      { id: "sent-on-cutoff", org_id: ORG, token: "b", accepted_at: null, sent_at: EXPIRED_CUTOFF, created_at: JUST_PAST_EXPIRED },
      { id: "resent", org_id: ORG, token: "c", accepted_at: null, sent_at: "2026-10-01T00:00:00.000Z", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "never-sent-past", org_id: ORG, token: "d", accepted_at: null, sent_at: null, created_at: JUST_PAST_EXPIRED },
      { id: "never-sent-on-cutoff", org_id: ORG, token: "e", accepted_at: null, sent_at: null, created_at: EXPIRED_CUTOFF },
      { id: "accepted", org_id: ORG, token: "f", accepted_at: "2020-02-01T00:00:00.000Z", sent_at: "2020-01-01T00:00:00.000Z", created_at: "2020-01-01T00:00:00.000Z" },
    ],
  });

  const { removed } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(removed.familyInvites, 2);
  assertEquals(ids(tables.family_invites), [
    "accepted",
    "never-sent-on-cutoff",
    "resent",
    "sent-on-cutoff",
  ]);
});

Deno.test("family_invites: a request that can still be used holds its invite", async () => {
  const invite = (id: string, token: string) => ({
    id,
    org_id: ORG,
    token,
    accepted_at: null,
    sent_at: JUST_PAST_EXPIRED,
    created_at: JUST_PAST_EXPIRED,
  });
  const request = (over: Row) => ({
    id: over.invite_token,
    org_id: ORG,
    status: "approved",
    reviewed_at: null,
    approved_role: null,
    signup_token: null,
    token_expires_at: null,
    ...over,
  });
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [
      request({ invite_token: "pending", status: "pending" }),
      request({ invite_token: "live", signup_token: "t1", token_expires_at: "2026-11-04T00:00:00.000Z" }),
      request({ invite_token: "no-expiry", signup_token: "t2" }),
      request({ invite_token: "lapsed", signup_token: "t3", token_expires_at: "2026-10-01T00:00:00.000Z" }),
      request({ invite_token: "consumed", token_expires_at: "2026-11-04T00:00:00.000Z" }),
      request({ invite_token: "expiring-tonight", signup_token: "t4", token_expires_at: JUST_PAST_EXPIRED }),
    ],
    family_invites: ["pending", "live", "no-expiry", "lapsed", "consumed", "expiring-tonight"]
      .map((token) => invite(token, token)),
  });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed.accessRequests, 1);
  assertEquals(removed.familyInvites, 3);
  assertEquals(ids(tables.family_invites), ["live", "no-expiry", "pending"]);
});

for (
  const [label, options] of [
    ["errors", { failRead: ["access_requests"] }],
    ["is cut short by the row cap", { truncateRead: ["access_requests"] }],
  ] as const
) {
  Deno.test(`family_invites: nothing is deleted when the live read ${label}`, async () => {
    const { client, tables } = fakeClient({
      organizations: [org()],
      access_requests: [
        { id: "r1", org_id: ORG, status: "pending", invite_token: "held", signup_token: null },
      ],
      family_invites: [
        { id: "held", org_id: ORG, token: "held", accepted_at: null, sent_at: JUST_PAST_EXPIRED, created_at: JUST_PAST_EXPIRED },
      ],
    }, options);

    const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

    assertEquals(removed.familyInvites, 0);
    assertEquals(failures.map((f) => f.step), ["family_invites"]);
    assertEquals(ids(tables.family_invites), ["held"]);
  });
}

Deno.test("group_invites: revoked or expired past 90 days; a live open link stays", async () => {
  const link = (id: string, revoked_at: string | null, expires_at: string | null) => ({
    id,
    org_id: ORG,
    revoked_at,
    expires_at,
  });
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [],
    family_invites: [],
    group_invites: [
      link("revoked-past", JUST_PAST_EXPIRED, null),
      link("revoked-on-cutoff", EXPIRED_CUTOFF, null),
      link("expired-past", null, JUST_PAST_EXPIRED),
      link("expired-on-cutoff", null, EXPIRED_CUTOFF),
      link("never-expires", null, null),
      link("revoked-late-expired-long-ago", "2026-11-01T00:00:00.000Z", JUST_PAST_EXPIRED),
      link("revoked-long-ago-expires-later", JUST_PAST_EXPIRED, "2027-01-01T00:00:00.000Z"),
    ],
  });

  const { removed } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(removed.groupInvites, 4);
  assertEquals(ids(tables.group_invites), [
    "expired-on-cutoff",
    "never-expires",
    "revoked-on-cutoff",
  ]);
});

Deno.test("feedback: past 12 months from created_at", async () => {
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [],
    feedback: [
      { id: "past", org_id: ORG, created_at: JUST_PAST_FEEDBACK },
      { id: "on-cutoff", org_id: ORG, created_at: FEEDBACK_CUTOFF },
    ],
  });

  const { removed } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(removed.feedback, 1);
  assertEquals(ids(tables.feedback), ["on-cutoff"]);
});

Deno.test("prayer_requests: untouched and not even queried while the setting is off", async () => {
  const { client, tables, queries } = fakeClient({
    organizations: [org(null)],
    access_requests: [],
    prayer_requests: [{ id: "ancient", org_id: ORG, created_at: "2015-01-01T00:00:00.000Z" }],
  });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed.prayerRequests, 0);
  assertEquals(ids(tables.prayer_requests), ["ancient"]);
  assertEquals(queries.filter((q) => q.table === "prayer_requests"), []);
});

Deno.test("prayer_requests: past the chosen period from created_at, whatever updated_at says", async () => {
  const { client, tables } = fakeClient({
    organizations: [org(6)],
    access_requests: [],
    prayer_requests: [
      { id: "past-edited", org_id: ORG, created_at: JUST_PAST_SIX_MONTHS, updated_at: "2026-11-02T00:00:00.000Z" },
      { id: "on-cutoff", org_id: ORG, created_at: SIX_MONTH_CUTOFF, updated_at: SIX_MONTH_CUTOFF },
    ],
  });

  const { removed } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(removed.prayerRequests, 1);
  assertEquals(ids(tables.prayer_requests), ["on-cutoff"]);
});

Deno.test("prayer_requests: a failed setting read deletes nothing and is a failure", async () => {
  for (
    const [organizations, options, expected] of [
      [[], {}, "the church's row was not returned"],
      [[org(6)], { failRead: ["organizations"] }, "organizations read refused"],
      [[org(7)], {}, "unknown prayer request period: 7"],
    ] as const
  ) {
    const { client, tables } = fakeClient({
      organizations: [...organizations],
      access_requests: [],
      prayer_requests: [{ id: "ancient", org_id: ORG, created_at: "2015-01-01T00:00:00.000Z" }],
    }, options);

    const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

    assertEquals(removed.prayerRequests, 0);
    assertEquals(failures, [{ step: "prayer_requests", error: expected }]);
    assertEquals(ids(tables.prayer_requests), ["ancient"]);
  }
});

Deno.test("serving_reminder_passes: a pass older than 35 days goes, one on the cutoff stays", async () => {
  const { client, tables } = fakeClient({
    organizations: [org()],
    serving_reminder_passes: [
      { id: "old", org_id: ORG, send_date: JUST_PAST_REMINDERS },
      { id: "on-cutoff", org_id: ORG, send_date: REMINDER_CUTOFF },
      { id: "recent", org_id: ORG, send_date: "2026-11-02" },
    ],
  });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed.reminderPasses, 1);
  assertEquals(ids(tables.serving_reminder_passes), ["on-cutoff", "recent"]);
});

Deno.test("serving_reminder_passes: a backlog is deleted a batch at a time and counted whole", async () => {
  const backlog = Array.from({ length: DELETE_BATCH * 2 + 1 }, (_, i) => ({
    id: `p${i}`,
    org_id: ORG,
    send_date: JUST_PAST_REMINDERS,
  }));
  const { client, tables, queries } = fakeClient({ organizations: [org()], serving_reminder_passes: backlog });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed.reminderPasses, DELETE_BATCH * 2 + 1);
  assertEquals(ids(tables.serving_reminder_passes), []);
  assertEquals(queries.filter((q) => q.table === "serving_reminder_passes").length, 3);
});

Deno.test("every query is bound to the org being cleaned, and another church's rows stay", async () => {
  const old = JUST_PAST_EXPIRED;
  const { client, tables, queries } = fakeClient({
    organizations: [org(6), org(6, OTHER_ORG)],
    access_requests: [
      { id: "theirs", org_id: OTHER_ORG, status: "denied", reviewed_at: old, invite_token: null },
    ],
    family_invites: [{ id: "theirs", org_id: OTHER_ORG, token: "x", accepted_at: null, sent_at: old, created_at: old }],
    group_invites: [{ id: "theirs", org_id: OTHER_ORG, revoked_at: old, expires_at: null }],
    feedback: [{ id: "theirs", org_id: OTHER_ORG, created_at: JUST_PAST_FEEDBACK }],
    prayer_requests: [{ id: "theirs", org_id: OTHER_ORG, created_at: JUST_PAST_SIX_MONTHS }],
    serving_reminder_passes: [{ id: "theirs", org_id: OTHER_ORG, send_date: JUST_PAST_REMINDERS }],
  });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, []);
  assertEquals(removed, {
    accessRequests: 0,
    familyInvites: 0,
    groupInvites: 0,
    feedback: 0,
    prayerRequests: 0,
    reminderPasses: 0,
  });
  for (const table of ["access_requests", "family_invites", "group_invites", "feedback", "prayer_requests", "serving_reminder_passes"]) {
    assertEquals(ids(tables[table]), ["theirs"], table);
  }
  assertEquals(queries.length > 0, true);
  for (const { table, filters } of queries) {
    const anchor = table === "organizations" ? `eq id=${ORG}` : `eq org_id=${ORG}`;
    assertEquals(filters.includes(anchor), true, `${table}: ${filters.join(", ")}`);
  }
  assertEquals(queries.some((q) => q.table === "organizations" && q.op === "delete"), false);
});

Deno.test("a delete error is a failure and not a zero; the other rules still run", async () => {
  const { client, tables } = fakeClient({
    organizations: [org()],
    access_requests: [],
    family_invites: [],
    group_invites: [{ id: "stuck", org_id: ORG, revoked_at: JUST_PAST_EXPIRED, expires_at: null }],
    feedback: [{ id: "old", org_id: ORG, created_at: JUST_PAST_FEEDBACK }],
  }, { failDelete: ["group_invites"] });

  const { removed, failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures.map((f) => f.step), ["group_invites revoked", "group_invites expired"]);
  assertEquals(removed.groupInvites, 0);
  assertEquals(removed.feedback, 1);
  assertEquals(ids(tables.feedback), []);
});

Deno.test("a delete that returns no count is a failure", async () => {
  const { client } = fakeClient({
    organizations: [org()],
    access_requests: [],
    feedback: [],
  }, { nullCount: ["feedback"] });

  const { failures } = await cleanUpOrg(client, ORG, NOW);

  assertEquals(failures, [{ step: "feedback", error: "the delete returned no count" }]);
});

Deno.test("one church failing does not stop the next, and the summary carries the failure", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  console.error = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    const { client, tables } = fakeClient({
      organizations: [org(), org(null, OTHER_ORG)],
      access_requests: [],
      feedback: [
        { id: "stuck", org_id: ORG, created_at: JUST_PAST_FEEDBACK, message: "secret message text" },
        { id: "gone", org_id: OTHER_ORG, created_at: JUST_PAST_FEEDBACK, message: "secret message text" },
      ],
    }, { failDelete: ["feedback"], failOnlyOrg: ORG });

    const results = await cleanUpOrgs(client, [ORG, OTHER_ORG], NOW);
    const summary = summarizeCleanup(results);

    assertEquals(summary.orgs, 2);
    assertEquals(summary.failed, [{ org: ORG, step: "feedback", error: "feedback delete refused" }]);
    assertEquals(summary.removed.find((r) => r.org === OTHER_ORG)?.feedback, 1);
    assertEquals(ids(tables.feedback), ["stuck"]);
    assertEquals(lines.some((line) => line.includes(ORG) && line.includes("feedback")), true);
    assertEquals(lines.some((line) => line.includes("secret message text")), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

Deno.test("a clean run summarizes with no failures", () => {
  const removed = { accessRequests: 1, familyInvites: 2, groupInvites: 3, feedback: 4, prayerRequests: 5, reminderPasses: 6 };
  assertEquals(summarizeCleanup([{ orgId: ORG, removed, failures: [] }]), {
    orgs: 1,
    removed: [{ org: ORG, ...removed }],
    failed: [],
  });
});
