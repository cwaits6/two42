// The supper reminder run against a recording fake: the church every chain
// and call carries, who the email reaches and what it says, and how the
// daily cap and Resend's answers settle the sent record.

import { assertEquals } from "jsr:@std/assert@1";
import type { ReminderSupperRow } from "../_shared/supper-reminder-due.ts";
import {
  type SupperClaimRow,
  type SupperReminder,
  type SupperRemindersClient,
  runSupperReminders,
} from "../_shared/supper-reminders.ts";
import type { Org } from "../_shared/orgs.ts";
import type { SendOutcome } from "../_shared/serving-hourly.ts";

const church = (id: string): Org => ({
  id,
  name: id,
  timezone: "America/Chicago",
  branding: null,
  org_email_domains: [],
});

const NOW = new Date("2027-01-08T15:00:00Z");

const supper = (id: string, starts_at: string, group_id = "g1"): ReminderSupperRow => ({
  id,
  group_id,
  rotation_id: `rotation-${group_id}`,
  table_id: `table-${id}`,
  starts_at,
  host_party_id: "host",
});

const claim = (profile_id: string): SupperClaimRow => ({
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
  /** Per org, the groups with the Supper club on. */
  on?: Record<string, string[]>;
  suppers?: Record<string, ReminderSupperRow[]>;
  claims?: Record<string, SupperClaimRow[]>;
  notGoing?: string[];
  capLeft?: number;
  /** Per org, the rotations that have ended; the fake keeps them out of a published-only read. */
  ended?: Record<string, string[]>;
  bringListOff?: boolean;
  /** What each party brings to every supper. */
  bringing?: Record<string, string>;
}

function fakeClient(options: FakeOptions = {}) {
  const queries: Recorded[] = [];
  let capLeft = options.capLeft ?? Infinity;

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
      gte: (column: string, value: string) => filter(`${column}>=${value}`),
      lt: (column: string, value: string) => filter(`${column}<${value}`),
      order: () => chain,
      range: (from: number, to: number) => filter(`range ${from}-${to}`),
      in: (column: string, values: readonly unknown[]) => filter(`${column} in ${JSON.stringify(values)}`),
      then(resolve: (v: unknown) => unknown) {
        const org = recorded.filters.find((f) => f.startsWith("org_id="))?.slice("org_id=".length) ?? "";
        const ok = (data: unknown) => resolve({ data, error: null });
        switch (table) {
          case "group_settings":
            return ok((options.on?.[org] ?? []).map((group_id) => ({ group_id })));
          case "supper_rotations":
            return ok(
              (options.on?.[org] ?? [])
                .filter((g) => !(recorded.filters.includes("status=published") && options.ended?.[org]?.includes(g)))
                .map((g) => ({ id: `rotation-${g}`, title: "Supper Club", bring_list_enabled: !options.bringListOff })),
            );
          case "supper_contributions":
            return ok(Object.entries(options.bringing ?? {}).map(([party_id, item]) => ({ party_id, item })));
          case "suppers":
            return ok(options.suppers?.[org] ?? []);
          case "supper_seats":
            return ok([{ party_id: "host" }, { party_id: "guests" }]);
          case "supper_party_members":
            return ok([
              { party_id: "host", profile_id: "henry" },
              { party_id: "host", profile_id: "chloe" },
              { party_id: "guests", profile_id: "isaac" },
              { party_id: "guests", profile_id: "ruth" },
            ]);
          case "profiles":
            return ok(["henry", "chloe", "isaac", "ruth"].map((id) => ({
              id,
              first_name: id[0].toUpperCase() + id.slice(1),
              preferred_name: null,
            })));
          case "supper_replies":
            return ok((options.notGoing ?? []).map((profile_id) => ({ profile_id })));
          case "supper_party_addresses":
            return ok([{ address_line1: "12 Fixture Lane", address_line2: null, city: "Springfield", state: "IL", postal_code: null }]);
          default:
            return resolve({ error: null });
        }
      },
    };
    return chain;
  }

  const client = {
    from,
    rpc(fn: string, args: Record<string, unknown>) {
      queries.push({ rpc: fn, args, filters: [] });
      if (fn === "email_quota_consume") return Promise.resolve({ data: capLeft-- > 0, error: null });
      return Promise.resolve({ data: options.claims?.[args._supper_id as string] ?? [], error: null });
    },
  } as unknown as SupperRemindersClient;

  return { client, queries };
}

function deps(outcomes: SendOutcome[] = []) {
  const mailed: SupperReminder[] = [];
  return {
    mailed,
    deps: {
      now: NOW,
      budgetMs: 90_000,
      elapsed: () => 0,
      sender: () => (reminder: SupperReminder) => {
        mailed.push(reminder);
        return Promise.resolve(outcomes.shift() ?? "sent");
      },
    },
  };
}

const orgOf = (q: Recorded) =>
  q.rpc ? q.args!._org_id : q.filters.find((f) => f.startsWith("org_id="))?.slice("org_id=".length);

Deno.test("every chain and every call carries the church being run", async () => {
  const { client, queries } = fakeClient({
    on: { "org-a": ["g1"], "org-b": ["g2"] },
    suppers: {
      "org-a": [supper("a1", "2027-01-10T00:00:00Z")],
      "org-b": [supper("b1", "2027-01-10T01:00:00Z", "g2")],
    },
    claims: { a1: [claim("isaac")], b1: [claim("ruth")] },
  });
  const { deps: d, mailed } = deps();
  const run = await runSupperReminders(client, [church("org-a"), church("org-b")], d);

  assertEquals(run.emailsSent, 2);
  assertEquals(mailed.map((m) => `${m.orgId}:${m.supper.supperId}:${m.profileId}`), ["org-a:a1:isaac", "org-b:b1:ruth"]);
  assertEquals(queries.every((q) => orgOf(q) === "org-a" || orgOf(q) === "org-b"), true);
  const firstB = queries.findIndex((q) => orgOf(q) === "org-b");
  assertEquals(queries.slice(0, firstB).every((q) => orgOf(q) === "org-a"), true);
  assertEquals(queries.slice(firstB).every((q) => orgOf(q) === "org-b"), true);
  assertEquals(
    queries.find((q) => q.rpc === "supper_reminder_claim" && q.args!._supper_id === "b1")!.args,
    {
      _org_id: "org-b",
      _supper_id: "b1",
      _supper_date: "2027-01-09",
      _starts_at: "2027-01-10T01:00:00Z",
      _host_party_id: "host",
    },
  );
});

Deno.test("only the due supper is claimed, and only in groups with the Supper club on", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("due", "2027-01-10T00:00:00Z"), supper("later", "2027-01-11T00:00:00Z")] },
    claims: { due: [claim("isaac")] },
  });
  await runSupperReminders(client, [church("o")], deps().deps);
  assertEquals(queries.filter((q) => q.rpc === "supper_reminder_claim").map((q) => q.args!._supper_id), ["due"]);
  assertEquals(queries.find((q) => q.table === "supper_rotations")!.filters, [
    "org_id=o",
    "status=published",
    'group_id in ["g1"]',
  ]);

  const off = fakeClient({ on: {}, suppers: { o: [supper("due", "2027-01-10T00:00:00Z")] } });
  await runSupperReminders(off.client, [church("o")], deps().deps);
  assertEquals(off.queries.some((q) => q.table === "suppers" || q.rpc === "supper_reminder_claim"), false);
});

Deno.test("the email gets the host, the address and who is coming, leaving out who said not going", async () => {
  const { client } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
    notGoing: ["ruth"],
  });
  const { deps: d, mailed } = deps();
  await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed[0].bringing, null);
  assertEquals(mailed[0].details, {
    rotationTitle: "Supper Club",
    hostNames: "Henry and Chloe",
    address: "12 Fixture Lane, Springfield, IL",
    coming: ["Henry", "Chloe", "Isaac"],
  });
});

Deno.test("a sent reminder is recorded, and one the daily cap refuses is released unsent", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac"), claim("ruth")] },
    capLeft: 1,
  });
  const { deps: d, mailed } = deps();
  const run = await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => m.profileId), ["isaac"]);
  assertEquals(run.capped, 1);
  const settles = queries.filter((q) => q.table === "supper_reminder_sends");
  assertEquals(settles.map((q) => [q.values, q.filters]), [
    [{ sent_at: NOW.toISOString() }, ["org_id=o", "supper_id=d1", "supper_date=2027-01-09", 'profile_id in ["isaac"]']],
    [{ claimed_at: null }, ["org_id=o", "supper_id=d1", "supper_date=2027-01-09", 'profile_id in ["ruth"]']],
  ]);
});

Deno.test("a cap of nothing sends nothing", async () => {
  const { client } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
    capLeft: 0,
  });
  const { deps: d, mailed } = deps();
  await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed, []);
});

Deno.test("each guest's reminder says what their party brings, and the host's says nothing", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac"), claim("ruth"), claim("henry")] },
    bringing: { guests: "Dessert", host: "Bread" },
  });
  const { deps: d, mailed } = deps();
  await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => [m.profileId, m.bringing]), [["isaac", "Dessert"], ["ruth", "Dessert"], ["henry", null]]);
  assertEquals(queries.find((q) => q.table === "supper_contributions")!.filters, ["org_id=o", "supper_id=d1"]);
});

Deno.test("a rotation with the bring list off reads no contributions", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
    bringListOff: true,
    bringing: { guests: "Dessert" },
  });
  const { deps: d, mailed } = deps();
  await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed[0].bringing, null);
  assertEquals(queries.some((q) => q.table === "supper_contributions"), false);
});

Deno.test("an ended rotation's suppers get no reminder", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    ended: { o: ["g1"] },
    suppers: { o: [supper("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
  });
  const { deps: d, mailed } = deps();
  await runSupperReminders(client, [church("o")], d);
  assertEquals(mailed, []);
  assertEquals(queries.some((q) => q.table === "suppers" || q.rpc === "supper_reminder_claim"), false);
});
