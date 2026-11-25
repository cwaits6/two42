// The dinner reminder run against a recording fake: the church every chain
// and call carries, who the email reaches and what it says, and how the
// daily cap and Resend's answers settle the sent record.

import { assertEquals } from "jsr:@std/assert@1";
import type { ReminderDinnerRow } from "../_shared/dinner-reminder-due.ts";
import {
  type DinnerClaimRow,
  type DinnerReminder,
  type DinnerRemindersClient,
  runDinnerReminders,
} from "../_shared/dinner-reminders.ts";
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

const dinner = (id: string, starts_at: string, group_id = "g1"): ReminderDinnerRow => ({
  id,
  group_id,
  season_id: `season-${group_id}`,
  table_id: `table-${id}`,
  starts_at,
  host_party_id: "host",
});

const claim = (profile_id: string): DinnerClaimRow => ({
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
  /** Per org, the groups with the dinner club on. */
  on?: Record<string, string[]>;
  dinners?: Record<string, ReminderDinnerRow[]>;
  claims?: Record<string, DinnerClaimRow[]>;
  notGoing?: string[];
  capLeft?: number;
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
      in: (column: string, values: readonly unknown[]) => filter(`${column} in ${JSON.stringify(values)}`),
      then(resolve: (v: unknown) => unknown) {
        const org = recorded.filters.find((f) => f.startsWith("org_id="))?.slice("org_id=".length) ?? "";
        const ok = (data: unknown) => resolve({ data, error: null });
        switch (table) {
          case "group_settings":
            return ok((options.on?.[org] ?? []).map((group_id) => ({ group_id })));
          case "dinner_seasons":
            return ok((options.on?.[org] ?? []).map((g) => ({ id: `season-${g}`, title: "Supper Club" })));
          case "dinners":
            return ok(options.dinners?.[org] ?? []);
          case "dinner_seats":
            return ok([{ party_id: "host" }, { party_id: "guests" }]);
          case "dinner_party_members":
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
          case "dinner_replies":
            return ok((options.notGoing ?? []).map((profile_id) => ({ profile_id })));
          case "dinner_party_addresses":
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
      return Promise.resolve({ data: options.claims?.[args._dinner_id as string] ?? [], error: null });
    },
  } as unknown as DinnerRemindersClient;

  return { client, queries };
}

function deps(outcomes: SendOutcome[] = []) {
  const mailed: DinnerReminder[] = [];
  return {
    mailed,
    deps: {
      now: NOW,
      budgetMs: 90_000,
      elapsed: () => 0,
      sender: () => (reminder: DinnerReminder) => {
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
    dinners: {
      "org-a": [dinner("a1", "2027-01-10T00:00:00Z")],
      "org-b": [dinner("b1", "2027-01-10T01:00:00Z", "g2")],
    },
    claims: { a1: [claim("isaac")], b1: [claim("ruth")] },
  });
  const { deps: d, mailed } = deps();
  const run = await runDinnerReminders(client, [church("org-a"), church("org-b")], d);

  assertEquals(run.emailsSent, 2);
  assertEquals(mailed.map((m) => `${m.orgId}:${m.dinner.dinnerId}:${m.profileId}`), ["org-a:a1:isaac", "org-b:b1:ruth"]);
  assertEquals(queries.every((q) => orgOf(q) === "org-a" || orgOf(q) === "org-b"), true);
  const firstB = queries.findIndex((q) => orgOf(q) === "org-b");
  assertEquals(queries.slice(0, firstB).every((q) => orgOf(q) === "org-a"), true);
  assertEquals(queries.slice(firstB).every((q) => orgOf(q) === "org-b"), true);
  assertEquals(
    queries.find((q) => q.rpc === "dinner_reminder_claim" && q.args!._dinner_id === "b1")!.args,
    { _org_id: "org-b", _dinner_id: "b1", _dinner_date: "2027-01-09" },
  );
});

Deno.test("only the due dinner is claimed, and only in groups with the dinner club on", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    dinners: { o: [dinner("due", "2027-01-10T00:00:00Z"), dinner("later", "2027-01-11T00:00:00Z")] },
    claims: { due: [claim("isaac")] },
  });
  await runDinnerReminders(client, [church("o")], deps().deps);
  assertEquals(queries.filter((q) => q.rpc === "dinner_reminder_claim").map((q) => q.args!._dinner_id), ["due"]);
  assertEquals(queries.find((q) => q.table === "dinner_seasons")!.filters, [
    "org_id=o",
    "status=published",
    'group_id in ["g1"]',
  ]);

  const off = fakeClient({ on: {}, dinners: { o: [dinner("due", "2027-01-10T00:00:00Z")] } });
  await runDinnerReminders(off.client, [church("o")], deps().deps);
  assertEquals(off.queries.some((q) => q.table === "dinners" || q.rpc === "dinner_reminder_claim"), false);
});

Deno.test("the email gets the host, the address and who is coming, leaving out who said not going", async () => {
  const { client } = fakeClient({
    on: { o: ["g1"] },
    dinners: { o: [dinner("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
    notGoing: ["ruth"],
  });
  const { deps: d, mailed } = deps();
  await runDinnerReminders(client, [church("o")], d);
  assertEquals(mailed[0].details, {
    seasonTitle: "Supper Club",
    hostNames: "Henry and Chloe",
    address: "12 Fixture Lane, Springfield, IL",
    coming: ["Henry", "Chloe", "Isaac"],
  });
});

Deno.test("a sent reminder is recorded, and one the daily cap refuses is released unsent", async () => {
  const { client, queries } = fakeClient({
    on: { o: ["g1"] },
    dinners: { o: [dinner("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac"), claim("ruth")] },
    capLeft: 1,
  });
  const { deps: d, mailed } = deps();
  const run = await runDinnerReminders(client, [church("o")], d);
  assertEquals(mailed.map((m) => m.profileId), ["isaac"]);
  assertEquals(run.capped, 1);
  const settles = queries.filter((q) => q.table === "dinner_reminder_sends");
  assertEquals(settles.map((q) => [q.values, q.filters]), [
    [{ sent_at: NOW.toISOString() }, ["org_id=o", "dinner_id=d1", "dinner_date=2027-01-09", 'profile_id in ["isaac"]']],
    [{ claimed_at: null }, ["org_id=o", "dinner_id=d1", "dinner_date=2027-01-09", 'profile_id in ["ruth"]']],
  ]);
});

Deno.test("a cap of nothing sends nothing", async () => {
  const { client } = fakeClient({
    on: { o: ["g1"] },
    dinners: { o: [dinner("d1", "2027-01-10T00:00:00Z")] },
    claims: { d1: [claim("isaac")] },
    capLeft: 0,
  });
  const { deps: d, mailed } = deps();
  await runDinnerReminders(client, [church("o")], d);
  assertEquals(mailed, []);
});
