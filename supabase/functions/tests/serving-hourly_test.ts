// The hourly run against a recording fake: what each firing costs a church
// in queries, and how the sent record, the time budget and Resend's answers
// decide what goes out.

import { assertEquals } from "jsr:@std/assert@1";
import {
  type ClaimRow,
  type DueRow,
  type HourlyClient,
  type Recipient,
  runHourly,
  type SendOutcome,
} from "../_shared/serving-hourly.ts";
import type { Org } from "../_shared/orgs.ts";

const church = (id: string, timezone: string): Org => ({
  id,
  name: id,
  timezone,
  branding: null,
  org_email_domains: [],
});

// 14:00 UTC on Thursday, Nov 5: 9 AM in New York, 6 AM in Los Angeles, 4 AM in Honolulu.
const NOW = new Date("2026-11-05T14:00:00Z");

interface Recorded {
  table?: string;
  rpc?: string;
  filters: string[];
  values?: Record<string, unknown>;
  args?: unknown;
}

interface FakeOptions {
  rows?: Record<string, DueRow[]>;
  claims?: Record<string, ClaimRow[]>;
  failSettings?: boolean;
  failSettle?: boolean;
}

function fakeClient(options: FakeOptions = {}) {
  const queries: Recorded[] = [];

  function from(table: string) {
    const recorded: Recorded = { table, filters: [] };
    queries.push(recorded);
    const chain = {
      select: () => chain,
      update: (values: Record<string, unknown>) => {
        recorded.values = values;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        recorded.filters.push(`${column}=${String(value)}`);
        return chain;
      },
      contains: (column: string, value: unknown) => {
        recorded.filters.push(`${column}@>${JSON.stringify(value)}`);
        return chain;
      },
      in: (column: string, values: readonly unknown[]) => {
        recorded.filters.push(`${column} in ${JSON.stringify(values)}`);
        return chain;
      },
      then(resolve: (v: unknown) => unknown) {
        if (table === "serving_team_settings") {
          if (options.failSettings) return resolve({ data: null, error: { message: "settings refused" } });
          const org = recorded.filters.find((f) => f.startsWith("org_id="))!.slice("org_id=".length);
          return resolve({ data: options.rows?.[org] ?? [], error: null });
        }
        return resolve({ error: options.failSettle ? { message: "settle refused" } : null });
      },
    };
    return chain;
  }

  const client = {
    from,
    rpc(fn: string, args: { _org_id: string }) {
      queries.push({ rpc: fn, args, filters: [] });
      return Promise.resolve({ data: options.claims?.[args._org_id] ?? [], error: null });
    },
  } as unknown as HourlyClient;

  return { client, queries };
}

const team = (
  team_id: string,
  send_hour: number | null,
  passes: DueRow["teams"] extends infer T ? (T extends { serving_reminder_passes: infer P } ? P : never) : never = [],
): DueRow => ({
  team_id,
  reminder_days: [4],
  send_hour,
  teams: { name: `Team ${team_id}`, group_id: "g1", serving_reminder_passes: passes },
});

const claim = (team_id: string, profile_id: string): ClaimRow => ({
  team_id,
  profile_id,
  email: `${profile_id}@example.test`,
  first_name: profile_id,
  preferred_name: null,
});

function deps(
  outcomes: SendOutcome[] | ((r: Recipient) => SendOutcome) = [],
  budget: { budgetMs: number; elapsed: () => number } = { budgetMs: 90_000, elapsed: () => 0 },
) {
  const sent: Recipient[] = [];
  const answers = Array.isArray(outcomes) ? [...outcomes] : null;
  return {
    sent,
    deps: {
      now: NOW,
      ...budget,
      sender: () => (recipient: Recipient) => {
        sent.push(recipient);
        return Promise.resolve(
          answers ? answers.shift() ?? ("sent" as const) : (outcomes as (r: Recipient) => SendOutcome)(recipient),
        );
      },
    },
  };
}

const queriesFor = (queries: Recorded[], orgId: string) =>
  queries.filter((q) =>
    q.filters.includes(`org_id=${orgId}`) || (q.args as { _org_id?: string } | undefined)?._org_id === orgId
  );

Deno.test("a church whose clock is outside the window costs no query", async () => {
  const { client, queries } = fakeClient({ rows: { honolulu: [team("t1", null)] } });
  const summary = await runHourly(client, [church("honolulu", "Pacific/Honolulu")], deps().deps);
  assertEquals(queries.length, 0);
  assertEquals(summary.due, 0);
  assertEquals(summary.emailsSent, 0);
});

Deno.test("a church with nothing due costs one query", async () => {
  // Los Angeles is at 6 AM: inside the window, but before every team's hour.
  const { client, queries } = fakeClient({ rows: { la: [team("t1", null), team("t2", 7)] } });
  const summary = await runHourly(client, [church("la", "America/Los_Angeles")], deps().deps);
  assertEquals(queries.length, 1);
  assertEquals(queries[0].table, "serving_team_settings");
  assertEquals(queries[0].filters, [
    "org_id=la",
    "enabled=true",
    'reminder_days@>[4]',
    "teams.serving_reminder_passes.send_date=2026-11-05",
  ]);
  assertEquals(summary.due, 0);
});

Deno.test("a team whose pass finished today costs no further work", async () => {
  const finished = [{ send_date: "2026-11-05", serving_reminder_sends: [{ sent_at: "2026-11-05T13:00:00Z" }] }];
  const { client, queries } = fakeClient({ rows: { ny: [team("t1", 9, finished)] } });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps().deps);
  assertEquals(queries.length, 1);
  assertEquals(summary.due, 0);
});

Deno.test("a pass with nothing to send counts as finished, so a later sign-up gets no reminder", async () => {
  const openAtPass = [{ send_date: "2026-11-05", serving_reminder_sends: [] }];
  const { client, queries } = fakeClient({ rows: { ny: [team("t1", 9, openAtPass)] } });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps().deps);
  assertEquals(queries.length, 1);
  assertEquals(summary.due, 0);
});

Deno.test("a due team is claimed once per church, mailed, and settled per team", async () => {
  const { client, queries } = fakeClient({
    rows: { ny: [team("t1", 9), team("t2", 9), team("t3", 18)] },
    claims: { ny: [claim("t1", "ann"), claim("t1", "bob"), claim("t2", "cat")] },
  });
  const { deps: d, sent } = deps();
  const summary = await runHourly(client, [church("ny", "America/New_York")], d);

  assertEquals(summary.due, 2);
  assertEquals(summary.emailsSent, 3);
  assertEquals(sent.map((r) => [r.teamId, r.email, r.sendDate, r.serviceDate]), [
    ["t1", "ann@example.test", "2026-11-05", "2026-11-08"],
    ["t1", "bob@example.test", "2026-11-05", "2026-11-08"],
    ["t2", "cat@example.test", "2026-11-05", "2026-11-08"],
  ]);

  const [settings, rpc, settleT1, settleT2] = queries;
  assertEquals(settings.table, "serving_team_settings");
  assertEquals(rpc.rpc, "serving_reminder_claim");
  assertEquals(rpc.args, {
    _org_id: "ny",
    _send_date: "2026-11-05",
    _service_date: "2026-11-08",
    _team_ids: ["t1", "t2"],
  });
  assertEquals(queries.length, 4);
  assertEquals(settleT1.table, "serving_reminder_sends");
  assertEquals(settleT1.values, { sent_at: NOW.toISOString() });
  assertEquals(settleT1.filters, ["org_id=ny", "team_id=t1", "send_date=2026-11-05", 'profile_id in ["ann","bob"]']);
  assertEquals(settleT2.filters, ["org_id=ny", "team_id=t2", "send_date=2026-11-05", 'profile_id in ["cat"]']);
});

Deno.test("a pass left unfinished by an earlier firing is picked up", async () => {
  const unfinished = [{ send_date: "2026-11-05", serving_reminder_sends: [{ sent_at: "2026-11-05T13:00:00Z" }, { sent_at: null }] }];
  const { client, queries } = fakeClient({
    rows: { ny: [team("t1", 9, unfinished)] },
    claims: { ny: [claim("t1", "bob")] },
  });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps().deps);
  assertEquals(summary.due, 1);
  assertEquals(summary.emailsSent, 1);
  assertEquals(queries.map((q) => q.table ?? q.rpc), ["serving_team_settings", "serving_reminder_claim", "serving_reminder_sends"]);
});

Deno.test("a send Resend refuses releases its claim and counts as a failed email", async () => {
  const { client, queries } = fakeClient({
    rows: { ny: [team("t1", 9)] },
    claims: { ny: [claim("t1", "ann"), claim("t1", "bob")] },
  });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps(["sent", "retry"]).deps);
  assertEquals(summary.emailsSent, 1);
  assertEquals(summary.emailsFailed, 1);
  assertEquals(summary.failedItems, []);
  const settles = queries.filter((q) => q.table === "serving_reminder_sends");
  assertEquals(settles.map((q) => [q.values, q.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["ann"]'],
    [{ claimed_at: null }, 'profile_id in ["bob"]'],
  ]);
});

Deno.test("a rate limit releases every remaining claim and stops the firing", async () => {
  const { client, queries } = fakeClient({
    rows: { ny: [team("t1", 9), team("t2", 9)], chicago: [team("t3", 8)] },
    claims: { ny: [claim("t1", "ann"), claim("t1", "bob"), claim("t2", "cat")], chicago: [claim("t3", "dan")] },
  });
  const { deps: d, sent } = deps(["sent", "rate_limited"]);
  const summary = await runHourly(
    client,
    [church("ny", "America/New_York"), church("chicago", "America/Chicago")],
    d,
  );
  assertEquals(summary.rateLimited, true);
  assertEquals(summary.emailsSent, 1);
  assertEquals(summary.emailsFailed, 0);
  assertEquals(sent.length, 2);
  const settles = queries.filter((q) => q.table === "serving_reminder_sends");
  assertEquals(settles.map((q) => [q.values, q.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["ann"]'],
    [{ claimed_at: null }, 'profile_id in ["bob"]'],
    [{ claimed_at: null }, 'profile_id in ["cat"]'],
  ]);
  // The second church is never read.
  assertEquals(queriesFor(queries, "chicago").length, 0);
});

Deno.test("a firing out of budget stops starting teams, releases what it claimed, and is not a failure", async () => {
  const { client, queries } = fakeClient({
    rows: { ny: [team("t1", 9)], chicago: [team("t2", 8)] },
    claims: { ny: [claim("t1", "ann"), claim("t1", "bob")], chicago: [claim("t2", "cat")] },
  });
  let calls = 0;
  const { deps: d, sent } = deps(["sent"], { budgetMs: 1000, elapsed: () => (calls++ > 1 ? 1000 : 0) });
  const summary = await runHourly(
    client,
    [church("ny", "America/New_York"), church("chicago", "America/Chicago")],
    d,
  );
  assertEquals(summary.budgetExhausted, true);
  assertEquals(summary.failed, []);
  assertEquals(summary.failedItems, []);
  assertEquals(summary.emailsSent, 1);
  assertEquals(sent.map((r) => r.email), ["ann@example.test"]);
  const settles = queries.filter((q) => q.table === "serving_reminder_sends");
  assertEquals(settles.map((q) => [q.values, q.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["ann"]'],
    [{ claimed_at: null }, 'profile_id in ["bob"]'],
  ]);
  assertEquals(queriesFor(queries, "chicago").length, 0);
});

Deno.test("a settings read that fails is that church's failure and the others still run", async () => {
  const { client } = fakeClient({ failSettings: true });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps().deps);
  assertEquals(summary.failed.map((f) => f.org), ["ny"]);
});

Deno.test("a zone Intl rejects fails that church before any query", async () => {
  const { client, queries } = fakeClient({ rows: { bad: [team("t1", 9)] } });
  const summary = await runHourly(client, [church("bad", "Nowhere/Bogus")], deps().deps);
  assertEquals(queries.length, 0);
  assertEquals(summary.failed.length, 1);
});

Deno.test("a settle that fails is recorded against the team after the mail went out", async () => {
  const { client } = fakeClient({ rows: { ny: [team("t1", 9)] }, claims: { ny: [claim("t1", "ann")] }, failSettle: true });
  const summary = await runHourly(client, [church("ny", "America/New_York")], deps().deps);
  assertEquals(summary.emailsSent, 1);
  assertEquals(summary.failedItems.map((f) => f.item), ["t1"]);
});
