// The event reminder run against a recording fake: the org every chain and
// call carries, and how the sent record, the time budget, the daily cap and
// Resend's answers decide what goes out.

import { assertEquals } from "jsr:@std/assert@1";
import type { ReminderEventRow } from "../_shared/event-reminder-due.ts";
import {
  type EventClaimRow,
  type EventReminder,
  type EventRemindersClient,
  reminderMode,
  runEventReminders,
} from "../_shared/event-reminders.ts";
import type { Org } from "../_shared/orgs.ts";
import type { SendOutcome } from "../_shared/serving-hourly.ts";

const church = (id: string): Org => ({
  id,
  name: id,
  timezone: "America/Chicago",
  branding: null,
  org_email_domains: [],
});

const NOW = new Date("2026-11-05T15:00:00Z");

const event = (id: string, hoursAhead: number, rest: Partial<ReminderEventRow> = {}): ReminderEventRow => ({
  id,
  group_id: "g1",
  title: `Event ${id}`,
  location: null,
  start_time: new Date(NOW.getTime() + hoursAhead * 3_600_000).toISOString(),
  recurrence_frequency: null,
  recurrence_interval: 1,
  recurrence_end_mode: null,
  recurrence_count: null,
  recurrence_until: null,
  series_id: null,
  series_occurrence_date: null,
  is_cancelled: false,
  reminder_days_before: 1,
  ...rest,
});

const claim = (profile_id: string): EventClaimRow => ({
  profile_id,
  email: `${profile_id}@example.test`,
  first_name: profile_id,
  preferred_name: null,
});

interface Recorded {
  table?: string;
  rpc?: string;
  filters: string[];
  values?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface FakeOptions {
  /** Per org, the rows the single-event read returns. */
  events?: Record<string, ReminderEventRow[]>;
  /** Per org, rows only a read by id returns: series starting past the horizon. */
  byId?: Record<string, ReminderEventRow[]>;
  /** Per org, the groups that are off. */
  groupsOff?: Record<string, string[]>;
  /** Per event id, what each claim call returns in turn; an Error is a refused call. */
  claims?: Record<string, Array<EventClaimRow[] | Error>>;
  failEvents?: boolean;
  failSettle?: boolean;
  /** How many more reminders the church's daily email cap allows; unlimited when absent. */
  capLeft?: number;
}

function fakeClient(options: FakeOptions = {}) {
  const queries: Recorded[] = [];
  let capLeft = options.capLeft ?? Infinity;
  const claims = new Map(Object.entries(options.claims ?? {}).map(([id, calls]) => [id, [...calls]]));

  function from(table: string) {
    const recorded: Recorded = { table, filters: [] };
    queries.push(recorded);
    const filter = (text: string) => {
      recorded.filters.push(text);
      return chain;
    };
    const chain = {
      select: () => chain,
      update: (values: Record<string, unknown>) => {
        recorded.values = values;
        return chain;
      },
      eq: (column: string, value: unknown) => filter(`${column}=${String(value)}`),
      is: (column: string, value: null) => filter(`${column} is ${String(value)}`),
      not: (column: string, operator: string, value: unknown) => filter(`${column} not ${operator} ${String(value)}`),
      gt: (column: string, value: string) => filter(`${column}>${value}`),
      gte: (column: string, value: string) => filter(`${column}>=${value}`),
      lte: (column: string, value: string) => filter(`${column}<=${value}`),
      in: (column: string, values: readonly unknown[]) => filter(`${column} in ${JSON.stringify(values)}`),
      order: () => chain,
      range: () => chain,
      then(resolve: (v: unknown) => unknown) {
        const org = recorded.filters.find((f) => f.startsWith("org_id="))?.slice("org_id=".length) ?? "";
        if (table === "events") {
          if (options.failEvents) return resolve({ data: null, error: { message: "events refused" } });
          const ids = recorded.filters.find((f) => f.startsWith("id in "))?.slice("id in ".length);
          if (ids) {
            const wanted = JSON.parse(ids) as string[];
            return resolve({ data: (options.byId?.[org] ?? []).filter((row) => wanted.includes(row.id)), error: null });
          }
          const single = recorded.filters.includes("recurrence_frequency is null");
          return resolve({ data: single ? options.events?.[org] ?? [] : [], error: null });
        }
        if (table === "group_settings") {
          return resolve({ data: (options.groupsOff?.[org] ?? []).map((group_id) => ({ group_id })), error: null });
        }
        return resolve({ error: options.failSettle ? { message: "settle refused" } : null });
      },
    };
    return chain;
  }

  const client = {
    from,
    rpc(fn: string, args: Record<string, unknown>) {
      queries.push({ rpc: fn, args, filters: [] });
      if (fn === "email_quota_consume") return Promise.resolve({ data: capLeft-- > 0, error: null });
      const next = claims.get(args._event_id as string)?.shift() ?? [];
      return Promise.resolve(
        next instanceof Error ? { data: null, error: { message: next.message } } : { data: next, error: null },
      );
    },
  } as unknown as EventRemindersClient;

  return { client, queries };
}

function deps(
  outcomes: Array<SendOutcome | Error> = [],
  budget: { budgetMs: number; elapsed: () => number } = { budgetMs: 90_000, elapsed: () => 0 },
) {
  const mailed: EventReminder[] = [];
  const answers = [...outcomes];
  return {
    mailed,
    deps: {
      now: NOW,
      ...budget,
      sender: () => (reminder: EventReminder) => {
        mailed.push(reminder);
        const answer = answers.shift() ?? "sent";
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    },
  };
}

const settles = (queries: Recorded[]) =>
  queries
    .filter((q) => q.table === "event_reminder_sends")
    .map((q) => ({ values: q.values, filters: q.filters }));

Deno.test("every chain and every call carries the church being run", async () => {
  const { client, queries } = fakeClient({
    events: { "org-a": [event("a1", 3)], "org-b": [event("b1", 4)] },
    claims: { a1: [[claim("ann")]], b1: [[claim("bob")]] },
  });
  const { deps: d, mailed } = deps();
  const summary = await runEventReminders(client, [church("org-a"), church("org-b")], d);

  assertEquals(summary.emailsSent, 2);
  assertEquals(summary.due, 2);
  assertEquals(mailed.map((m) => `${m.orgId}:${m.date.recordEventId}:${m.profileId}`), ["org-a:a1:ann", "org-b:b1:bob"]);

  const orgOf = (q: Recorded) =>
    q.rpc ? q.args!._org_id : q.filters.find((f) => f.startsWith("org_id="))?.slice("org_id=".length);
  const firstB = queries.findIndex((q) => orgOf(q) === "org-b");
  assertEquals(queries.every((q) => orgOf(q) === "org-a" || orgOf(q) === "org-b"), true);
  assertEquals(queries.slice(0, firstB).every((q) => orgOf(q) === "org-a"), true);
  assertEquals(queries.slice(firstB).every((q) => orgOf(q) === "org-b"), true);

  const claimCall = queries.find((q) => q.rpc === "event_reminder_claim" && q.args!._event_id === "b1")!;
  assertEquals(claimCall.args, {
    _org_id: "org-b",
    _event_id: "b1",
    _occurrence_date: "2026-11-05",
    _reply_event_id: null,
  });
});

Deno.test("a date moved earlier than its series' first date is reminded, its series read by id in the same church", async () => {
  const series = event("s", 15 * 24, { recurrence_frequency: "weekly", recurrence_end_mode: "never" });
  const moved = event("m", 3, { series_id: "s", series_occurrence_date: series.start_time });
  const { client, queries } = fakeClient({
    events: { o: [moved] },
    byId: { o: [series] },
    claims: { s: [[claim("ann")]] },
  });
  const { deps: d, mailed } = deps();
  const summary = await runEventReminders(client, [church("o")], d);

  assertEquals(summary.due, 1);
  assertEquals(mailed.map((m) => [m.date.recordEventId, m.date.replyEventId, m.date.startIso]), [
    ["s", "m", moved.start_time],
  ]);
  assertEquals(
    queries.filter((q) => q.table === "events" && q.filters.some((f) => f.startsWith("id in "))).map((q) => q.filters),
    [["org_id=o", 'id in ["s"]']],
  );
});

Deno.test("a series already read is not read again by id", async () => {
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] } });
  await runEventReminders(client, [church("o")], deps().deps);
  assertEquals(queries.some((q) => q.filters.some((f) => f.startsWith("id in "))), false);
});

Deno.test("a body runs the mode it names, the earlier schedule's body runs without the record, and anything else runs nothing", () => {
  assertEquals(reminderMode('{"mode":"dates"}'), "dates");
  assertEquals(reminderMode("{}"), "before-dates");
  assertEquals(reminderMode(""), "before-dates");
  assertEquals(reminderMode('{"mode":"daily"}'), null);
  assertEquals(reminderMode('{"mode":'), null);
  assertEquals(reminderMode("[]"), null);
  assertEquals(reminderMode("null"), null);
});

Deno.test("an accepted send is settled as sent, under the date's own key", async () => {
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [[claim("ann")]] } });
  await runEventReminders(client, [church("o")], deps().deps);
  assertEquals(settles(queries), [{
    values: { sent_at: NOW.toISOString() },
    filters: ["org_id=o", "event_id=e", "occurrence_date=2026-11-05", 'profile_id in ["ann"]'],
  }]);
});

Deno.test("a refused send is released and never recorded as sent", async () => {
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [[claim("ann"), claim("bob")]] } });
  const summary = await runEventReminders(client, [church("o")], deps(["retry", "sent"]).deps);
  assertEquals([summary.emailsSent, summary.emailsFailed], [1, 1]);
  assertEquals(settles(queries).map((s) => [s.values, s.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["bob"]'],
    [{ claimed_at: null }, 'profile_id in ["ann"]'],
  ]);
  assertEquals(summary.failedItems, []);
});

Deno.test("a second firing whose claim returns nothing sends nothing", async () => {
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [[claim("ann")], []] } });
  const first = deps();
  await runEventReminders(client, [church("o")], first.deps);
  const second = deps();
  const summary = await runEventReminders(client, [church("o")], second.deps);
  assertEquals(first.mailed.length, 1);
  assertEquals(second.mailed.length, 0);
  assertEquals([summary.due, summary.emailsSent], [1, 0]);
  assertEquals(settles(queries).length, 1);
});

Deno.test("a group that is off makes no claim", async () => {
  const { client, queries } = fakeClient({
    events: { o: [event("e", 3), event("f", 3, { group_id: "g2" })] },
    groupsOff: { o: ["g1"] },
    claims: { e: [[claim("ann")]], f: [[claim("bob")]] },
  });
  const { deps: d, mailed } = deps();
  await runEventReminders(client, [church("o")], d);
  assertEquals(queries.filter((q) => q.rpc === "event_reminder_claim").map((q) => q.args!._event_id), ["f"]);
  assertEquals(mailed.map((m) => m.profileId), ["bob"]);
  assertEquals(
    queries.find((q) => q.table === "group_settings")!.filters,
    ["org_id=o", "event_reminders_enabled=false"],
  );
});

Deno.test("the time budget stops new sends and releases what was claimed", async () => {
  let elapsed = 0;
  const { client, queries } = fakeClient({
    events: { o: [event("e", 3), event("f", 4)] },
    claims: { e: [[claim("ann"), claim("bob"), claim("cy")]], f: [[claim("dee")]] },
  });
  const { deps: d, mailed } = deps([], { budgetMs: 90_000, elapsed: () => elapsed });
  const send = d.sender;
  d.sender = () => {
    const inner = send();
    return (reminder) => {
      elapsed = 90_000;
      return inner(reminder);
    };
  };
  const summary = await runEventReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => m.profileId), ["ann"]);
  assertEquals(summary.budgetExhausted, true);
  assertEquals(settles(queries).map((s) => [s.values, s.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["ann"]'],
    [{ claimed_at: null }, 'profile_id in ["bob","cy"]'],
  ]);
  assertEquals(queries.filter((q) => q.rpc === "event_reminder_claim").length, 1, "the next date is not started");
  assertEquals(summary.failed.length + summary.failedItems.length, 0);
});

Deno.test("the daily cap releases the rest and counts them, later dates too", async () => {
  const { client, queries } = fakeClient({
    events: { o: [event("e", 3), event("f", 4)] },
    claims: { e: [[claim("ann"), claim("bob"), claim("cy")]], f: [[claim("dee")]] },
    capLeft: 1,
  });
  const { deps: d, mailed } = deps();
  const summary = await runEventReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => m.profileId), ["ann"]);
  assertEquals(summary.capped, 3);
  assertEquals([summary.emailsFailed, summary.failed.length, summary.failedItems.length], [0, 0, 0]);
  assertEquals(settles(queries).map((s) => [s.values, s.filters[1], s.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, "event_id=e", 'profile_id in ["ann"]'],
    [{ claimed_at: null }, "event_id=e", 'profile_id in ["bob","cy"]'],
    [{ claimed_at: null }, "event_id=f", 'profile_id in ["dee"]'],
  ]);
});

Deno.test("a rate limit stops the firing and releases the rest", async () => {
  const { client, queries } = fakeClient({
    events: { o: [event("e", 3), event("f", 4)], p: [event("g", 3)] },
    claims: { e: [[claim("ann"), claim("bob")]], f: [[claim("dee")]], g: [[claim("eve")]] },
  });
  const { deps: d, mailed } = deps(["rate_limited"]);
  const summary = await runEventReminders(client, [church("o"), church("p")], d);
  assertEquals(mailed.map((m) => m.profileId), ["ann"]);
  assertEquals([summary.rateLimited, summary.emailsFailed, summary.emailsSent], [true, 0, 0]);
  assertEquals(settles(queries).map((s) => [s.values, s.filters.at(-1)]), [
    [{ claimed_at: null }, 'profile_id in ["ann","bob"]'],
  ]);
  assertEquals(queries.filter((q) => q.rpc === "event_reminder_claim").length, 1);
});

Deno.test("a refused claim fails that event and the next date still goes out", async () => {
  const { client } = fakeClient({
    events: { o: [event("e", 3), event("f", 4)] },
    claims: { e: [new Error("claim refused")], f: [[claim("dee")]] },
  });
  const { deps: d, mailed } = deps();
  const summary = await runEventReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => m.profileId), ["dee"]);
  assertEquals(summary.failedItems, [{ org: "o", item: "e", error: "event_reminder_claim failed: claim refused" }]);
});

Deno.test("a sender that throws releases that reminder and records the event once", async () => {
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [[claim("ann"), claim("bob"), claim("cy")]] } });
  const summary = await runEventReminders(client, [church("o")], deps([new Error("boom"), new Error("boom")]).deps);
  assertEquals(summary.emailsSent, 1);
  assertEquals(summary.failedItems, [{ org: "o", item: "e", error: "send failed: boom" }]);
  assertEquals(settles(queries).map((s) => [s.values, s.filters.at(-1)]), [
    [{ sent_at: NOW.toISOString() }, 'profile_id in ["cy"]'],
    [{ claimed_at: null }, 'profile_id in ["ann","bob"]'],
  ]);
});

Deno.test("a failed read fails that church and the next still runs", async () => {
  const failing = fakeClient({ failEvents: true });
  const summary = await runEventReminders(failing.client, [church("o"), church("p")], deps().deps);
  assertEquals(summary.failed.map((f) => f.org), ["o", "p"]);
  assertEquals(summary.failed[0].error, "events query (series) failed: events refused");
});

Deno.test("a settle that fails is reported, so the firing is not a clean 200", async () => {
  const { client } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [[claim("ann")]] }, failSettle: true });
  const summary = await runEventReminders(client, [church("o")], deps().deps);
  assertEquals(summary.failedItems, [{ org: "o", item: "e", error: "event_reminder_sends update failed: settle refused" }]);
});

Deno.test("a long list is settled in parts", async () => {
  const people = Array.from({ length: 150 }, (_, i) => claim(`p${i}`));
  const { client, queries } = fakeClient({ events: { o: [event("e", 3)] }, claims: { e: [people] } });
  await runEventReminders(client, [church("o")], deps().deps);
  assertEquals(settles(queries).length, 2);
});
