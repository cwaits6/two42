// Unit tests for event-reminder recipient resolution. Pure units: no network,
// no database — the fake below satisfies EventRecipientClient structurally
// and applies the `.in()` filter itself so the membership gate is exercised
// by data, not by the fake's shape.

import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  resolveEventReminderRecipients,
  type EventRecipientClient,
} from "../_shared/event-recipients.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const GROUP = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVENT = "99999999-8888-7777-6666-555555555555";

interface RecordedChain {
  from: string;
  select: string;
  eq: Array<[string, unknown]>;
  in?: [string, unknown[]];
}

type Row = Record<string, unknown>;

function makeFakeClient(
  tables: Record<string, Row[]>,
  errors: Record<string, string> = {},
): { client: EventRecipientClient; chains: RecordedChain[] } {
  const chains: RecordedChain[] = [];
  const resolve = (chain: RecordedChain) => {
    if (errors[chain.from]) {
      return Promise.resolve({ data: null, error: { message: errors[chain.from] } });
    }
    const [col, values] = chain.in!;
    const data = (tables[chain.from] ?? []).filter((row) => values.includes(row[col]));
    return Promise.resolve({ data, error: null });
  };
  const client = {
    from(table: string) {
      const chain: RecordedChain = { from: table, select: "", eq: [] };
      chains.push(chain);
      const filters = {
        eq(column: string, value: unknown) {
          chain.eq.push([column, value]);
          return filters;
        },
        in(column: string, values: unknown[]) {
          chain.in = [column, values];
          return resolve(chain);
        },
      };
      return {
        select(columns: string) {
          chain.select = columns;
          return filters;
        },
      };
    },
  } as unknown as EventRecipientClient;
  return { client, chains };
}

// a, b: RSVPed, still members, have an email — the recipients.
// c: RSVPed but no longer a member — dropped by the membership gate.
// d: RSVPed and a member, but a profile with no email — skipped.
// e: RSVPed and still has a membership row, but moved back to pending —
//    dropped without a log line.
// x: a member who never RSVPed — never reached.
const TABLES: Record<string, Row[]> = {
  rsvps: [
    { user_id: "a", status: "yes" },
    { user_id: "b", status: "maybe" },
    { user_id: "c", status: "yes" },
    { user_id: "d", status: "yes" },
    { user_id: "e", status: "yes" },
  ],
  group_members: [
    { profile_id: "a" },
    { profile_id: "b" },
    { profile_id: "x" },
    { profile_id: "d" },
    { profile_id: "e" },
  ],
  profiles: [
    { id: "a", first_name: "Ann", preferred_name: null, email: "a@example.com", role: "member" },
    { id: "b", first_name: "Bob", preferred_name: "Rob", email: "b@example.com", role: "admin" },
    { id: "d", first_name: "Dee", preferred_name: null, email: null, role: "member" },
    { id: "e", first_name: "Eve", preferred_name: null, email: "e@example.com", role: "pending" },
  ],
};

function withSilencedConsoleError<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = original;
  });
}

Deno.test("resolves RSVPs through current group membership to approved profiles with an email", async () => {
  const { client, chains } = makeFakeClient(TABLES);
  const recipients = await withSilencedConsoleError(() =>
    resolveEventReminderRecipients(client, ORG, GROUP, EVENT)
  );
  assertEquals(recipients, [
    { id: "a", first_name: "Ann", preferred_name: null, email: "a@example.com" },
    { id: "b", first_name: "Bob", preferred_name: "Rob", email: "b@example.com" },
  ]);

  assertEquals(chains.map((c) => c.from), ["rsvps", "group_members", "profiles"]);
  for (const chain of chains) {
    assertEquals(chain.eq.some(([col, val]) => col === "org_id" && val === ORG), true, chain.from);
  }
  const [rsvps, members, profiles] = chains;
  assertEquals(rsvps.select, "user_id");
  assertEquals(rsvps.eq, [["org_id", ORG], ["event_id", EVENT]]);
  assertEquals(rsvps.in, ["status", ["yes", "maybe"]]);
  assertEquals(members.select, "profile_id");
  assertEquals(members.eq, [["org_id", ORG], ["group_id", GROUP]]);
  assertEquals(members.in, ["profile_id", ["a", "b", "c", "d", "e"]]);
  assertEquals(profiles.select, "id, first_name, preferred_name, email, role");
  assertEquals(profiles.eq, [["org_id", ORG]]);
  assertEquals(profiles.in, ["id", ["a", "b", "d", "e"]]);
});

Deno.test("logs each skipped profile by id, never by address", async () => {
  const { client } = makeFakeClient(TABLES);
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    await resolveEventReminderRecipients(client, ORG, GROUP, EVENT);
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 1);
  assertEquals(logged[0].includes("d"), true);
  assertEquals(JSON.stringify(logged[0]).includes("@"), false);
});

Deno.test("no RSVPs short-circuits before touching group_members", async () => {
  const { client, chains } = makeFakeClient({ ...TABLES, rsvps: [] });
  assertEquals(await resolveEventReminderRecipients(client, ORG, GROUP, EVENT), []);
  assertEquals(chains.map((c) => c.from), ["rsvps"]);
});

Deno.test("no remaining members short-circuits before touching profiles", async () => {
  const { client, chains } = makeFakeClient({ ...TABLES, group_members: [] });
  assertEquals(await resolveEventReminderRecipients(client, ORG, GROUP, EVENT), []);
  assertEquals(chains.map((c) => c.from), ["rsvps", "group_members"]);
});

Deno.test("chunks id lists so no single .in() exceeds 200 values", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `p${i}`);
  const { client, chains } = makeFakeClient({
    rsvps: ids.map((id) => ({ user_id: id, status: "yes" })),
    group_members: ids.map((id) => ({ profile_id: id })),
    profiles: ids.map((id) => ({ id, first_name: null, preferred_name: null, email: `${id}@example.com`, role: "member" })),
  });
  const recipients = await resolveEventReminderRecipients(client, ORG, GROUP, EVENT);
  assertEquals(recipients.length, 450);
  assertEquals(chains.filter((c) => c.from === "group_members").length, 3);
  assertEquals(chains.filter((c) => c.from === "profiles").length, 3);
  for (const chain of chains) {
    assertEquals(chain.in![1].length <= 200, true);
    assertEquals(chain.eq.some(([col, val]) => col === "org_id" && val === ORG), true, chain.from);
  }
});

for (const table of ["rsvps", "group_members", "profiles"]) {
  Deno.test(`a ${table} query error rejects`, async () => {
    const { client } = makeFakeClient(TABLES, { [table]: "boom" });
    await assertRejects(
      () => resolveEventReminderRecipients(client, ORG, GROUP, EVENT),
      Error,
      `${table} query failed: boom`,
    );
  });
}
