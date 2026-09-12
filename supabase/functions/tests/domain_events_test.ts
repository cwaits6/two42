// Unit tests for the real events client's query predicates. A recording
// fake satisfies DomainEventsTableClient structurally, so the exact
// PostgREST chain each method issues is pinned here — in particular that
// the lookup carries .eq("org_id", …) and every insert an explicit org_id
// (the worker runs with BYPASSRLS, so that value is the tenant boundary),
// and that "unacknowledged" means acknowledged_at IS NULL on both the
// worker side and, by the same predicate, the /platform acknowledge route.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createDomainEventsClient,
  type DomainEventsQueryBuilder,
  type DomainEventsQueryResult,
  type DomainEventsTableClient,
} from "../_shared/domain-events.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const DOMAIN = "example.church";

type Call = [string, ...unknown[]];

interface Recorded {
  table?: string;
  calls: Call[];
}

function makeFake(result: DomainEventsQueryResult): { client: DomainEventsTableClient; recorded: Recorded } {
  const recorded: Recorded = { calls: [] };
  const builder: DomainEventsQueryBuilder = {
    select(columns, opts) {
      recorded.calls.push(["select", columns, opts]);
      return builder;
    },
    insert(values) {
      recorded.calls.push(["insert", values]);
      return builder;
    },
    eq(column, value) {
      recorded.calls.push(["eq", column, value]);
      return builder;
    },
    is(column, value) {
      recorded.calls.push(["is", column, value]);
      return builder;
    },
    then(onfulfilled, onrejected) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  const client: DomainEventsTableClient = {
    from(table) {
      recorded.table = table;
      return builder;
    },
  };
  return { client, recorded };
}

function has(recorded: Recorded, ...call: Call): boolean {
  return recorded.calls.some((c) => JSON.stringify(c) === JSON.stringify(call));
}

function names(recorded: Recorded): string[] {
  return recorded.calls.map((c) => c[0]);
}

// ── skip check ──────────────────────────────────────────────────────────────

Deno.test("hasUnacknowledgedPermanentFailure is a head count on (org_id, domain, event) with acknowledged_at IS NULL", async () => {
  const { client, recorded } = makeFake({ data: null, error: null, count: 1 });
  const skip = await createDomainEventsClient(client).hasUnacknowledgedPermanentFailure(ORG, DOMAIN);
  assertEquals(skip, true);
  assertEquals(recorded.table, "org_domain_worker_events");
  assert(has(recorded, "select", "id", { count: "exact", head: true }));
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "domain", DOMAIN));
  assert(has(recorded, "eq", "event", "attach_permanent_failure"));
  assert(has(recorded, "is", "acknowledged_at", null));
  assert(!names(recorded).includes("insert"));
});

Deno.test("hasUnacknowledgedPermanentFailure is false on a zero count", async () => {
  const { client } = makeFake({ data: null, error: null, count: 0 });
  assertEquals(await createDomainEventsClient(client).hasUnacknowledgedPermanentFailure(ORG, DOMAIN), false);
});

Deno.test("hasUnacknowledgedPermanentFailure treats a missing count as zero — one more attempt, never a parked row", async () => {
  const { client } = makeFake({ data: null, error: null });
  assertEquals(await createDomainEventsClient(client).hasUnacknowledgedPermanentFailure(ORG, DOMAIN), false);
});

Deno.test("a lookup error throws rather than reading as 'not skipped'", async () => {
  const { client } = makeFake({ data: null, error: { message: "boom" } });
  await assertRejects(
    () => createDomainEventsClient(client).hasUnacknowledgedPermanentFailure(ORG, DOMAIN),
    Error,
    "boom",
  );
});

// ── inserts ─────────────────────────────────────────────────────────────────

Deno.test("recordPermanentFailure inserts the event with an explicit org_id, the domain, and the detail", async () => {
  const { client, recorded } = makeFake({ data: null, error: null });
  await createDomainEventsClient(client).recordPermanentFailure(ORG, DOMAIN, "vercel conflict: taken");
  assertEquals(recorded.table, "org_domain_worker_events");
  assertEquals(recorded.calls, [
    ["insert", { org_id: ORG, domain: DOMAIN, event: "attach_permanent_failure", detail: "vercel conflict: taken" }],
  ]);
});

Deno.test("recordDetached inserts the event with an explicit org_id and the domain, no detail", async () => {
  const { client, recorded } = makeFake({ data: null, error: null });
  await createDomainEventsClient(client).recordDetached(ORG, DOMAIN);
  assertEquals(recorded.calls, [
    ["insert", { org_id: ORG, domain: DOMAIN, event: "detached", detail: null }],
  ]);
});

Deno.test("an insert error throws (the caller records the row as failed, never silently)", async () => {
  const { client } = makeFake({ data: null, error: { message: "rls" } });
  await assertRejects(() => createDomainEventsClient(client).recordDetached(ORG, DOMAIN), Error, "rls");
  await assertRejects(
    () => createDomainEventsClient(client).recordPermanentFailure(ORG, DOMAIN, "d"),
    Error,
    "rls",
  );
});
