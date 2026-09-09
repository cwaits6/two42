// Unit tests for the real lease client's query predicates. A recording fake
// satisfies DomainTableClient structurally, so the exact PostgREST chain
// each method issues is pinned here — in particular that every chain
// carries .eq("org_id", …) (the worker runs with BYPASSRLS, so that
// predicate is the tenant boundary) and that every write's success is
// judged by an affected-row signal, never by the absence of an error.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import {
  createDomainLeaseClient,
  type DomainQueryBuilder,
  type DomainQueryResult,
  type DomainTableClient,
} from "../_shared/domain-lease.ts";

const ORG = "11111111-2222-3333-4444-555555555555";
const ROW = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TOKEN = "99999999-8888-7777-6666-555555555555";
const WINDOW = 10 * 60 * 1000;

type Call = [string, ...unknown[]];

interface Recorded {
  table?: string;
  calls: Call[];
}

function makeFake(result: DomainQueryResult): { client: DomainTableClient; recorded: Recorded } {
  const recorded: Recorded = { calls: [] };
  const builder: DomainQueryBuilder = {
    select(columns) {
      recorded.calls.push(["select", columns]);
      return builder;
    },
    update(values) {
      recorded.calls.push(["update", values]);
      return builder;
    },
    delete(opts) {
      recorded.calls.push(["delete", opts]);
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
    gt(column, value) {
      recorded.calls.push(["gt", column, value]);
      return builder;
    },
    or(filters) {
      recorded.calls.push(["or", filters]);
      return builder;
    },
    order(column) {
      recorded.calls.push(["order", column]);
      return builder;
    },
    maybeSingle() {
      recorded.calls.push(["maybeSingle"]);
      return Promise.resolve(result);
    },
    then(onfulfilled, onrejected) {
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };
  const client: DomainTableClient = {
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

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ── listing ─────────────────────────────────────────────────────────────────

Deno.test("listVerifiedUnattached filters on org_id, verified, attached_at IS NULL", async () => {
  const { client, recorded } = makeFake({
    data: [{ id: ROW, domain: "example.church" }, { id: "x", domain: 42 }],
    error: null,
  });
  const rows = await createDomainLeaseClient(client).listVerifiedUnattached(ORG);
  assertEquals(recorded.table, "org_domains");
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "status", "verified"));
  assert(has(recorded, "is", "attached_at", null));
  assert(has(recorded, "order", "created_at"));
  // Malformed rows are dropped, never passed through as a half-typed row.
  assertEquals(rows, [{ id: ROW, domain: "example.church" }]);
});

Deno.test("listRemoving filters on org_id and status = removing, with no attached_at gate", async () => {
  const { client, recorded } = makeFake({ data: [], error: null });
  await createDomainLeaseClient(client).listRemoving(ORG);
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "status", "removing"));
  assert(!names(recorded).includes("is"));
});

Deno.test("a listing error throws rather than reading as an empty org", async () => {
  const { client } = makeFake({ data: null, error: { message: "boom" } });
  await assertRejects(() => createDomainLeaseClient(client).listVerifiedUnattached(ORG), Error, "boom");
});

// ── lease claim ─────────────────────────────────────────────────────────────

Deno.test("claimAttachLease issues the single-flight UPDATE with the full revalidating predicate", async () => {
  const { client, recorded } = makeFake({ data: { attach_claim_token: "whatever" }, error: null });
  const token = await createDomainLeaseClient(client).claimAttachLease(ROW, ORG, WINDOW);

  assert(typeof token === "string" && token.length > 0);
  const update = recorded.calls.find((c) => c[0] === "update");
  assert(update);
  const values = update[1] as Record<string, unknown>;
  assertEquals(values.attach_claim_token, token);
  assert(ISO.test(values.attach_claimed_at as string));

  assert(has(recorded, "eq", "id", ROW));
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "status", "verified"));
  assert(has(recorded, "is", "attached_at", null));
  const or = recorded.calls.find((c) => c[0] === "or");
  assert(or);
  assertStringIncludes(or[1] as string, "attach_claimed_at.is.null,attach_claimed_at.lt.");
  // The cutoff is the window ago, not now: a live lease must be refused.
  const cutoff = (or[1] as string).split("attach_claimed_at.lt.")[1];
  const age = Date.now() - new Date(cutoff).getTime();
  assert(age >= WINDOW - 1000 && age <= WINDOW + 5000, `cutoff age ${age}`);
  // Success is the RETURNING row, not the absence of an error.
  assertEquals(names(recorded).at(-1), "maybeSingle");
});

Deno.test("claimAttachLease returns null on zero rows (live lease elsewhere or state moved)", async () => {
  const { client } = makeFake({ data: null, error: null });
  assertEquals(await createDomainLeaseClient(client).claimAttachLease(ROW, ORG, WINDOW), null);
});

Deno.test("claimDetachLease predicates on status = removing and does NOT gate on attached_at", async () => {
  const { client, recorded } = makeFake({ data: { attach_claim_token: "x" }, error: null });
  const token = await createDomainLeaseClient(client).claimDetachLease(ROW, ORG, WINDOW);
  assert(token);
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "status", "removing"));
  assert(!names(recorded).includes("is"));
  assert(names(recorded).includes("or"));
});

Deno.test("a claim error throws (the caller records the row as failed)", async () => {
  const { client } = makeFake({ data: null, error: { message: "db down" } });
  await assertRejects(() => createDomainLeaseClient(client).claimAttachLease(ROW, ORG, WINDOW), Error, "db down");
});

// ── fenced stamp ────────────────────────────────────────────────────────────

Deno.test("stampAttached fences on token, domain, verified, unattached, AND a live lease", async () => {
  const { client, recorded } = makeFake({ data: { id: ROW }, error: null });
  const ok = await createDomainLeaseClient(client).stampAttached(ROW, ORG, TOKEN, "example.church", WINDOW);
  assertEquals(ok, true);

  const update = recorded.calls.find((c) => c[0] === "update");
  assert(update);
  const values = update[1] as Record<string, unknown>;
  assertEquals(Object.keys(values), ["attached_at"]);
  assert(ISO.test(values.attached_at as string));

  assert(has(recorded, "eq", "id", ROW));
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "attach_claim_token", TOKEN));
  assert(has(recorded, "eq", "domain", "example.church"));
  assert(has(recorded, "eq", "status", "verified"));
  assert(has(recorded, "is", "attached_at", null));
  const gt = recorded.calls.find((c) => c[0] === "gt");
  assert(gt);
  assertEquals(gt[1], "attach_claimed_at");
  const age = Date.now() - new Date(gt[2] as string).getTime();
  assert(age >= WINDOW - 1000 && age <= WINDOW + 5000, `live cutoff age ${age}`);
});

Deno.test("stampAttached is false on zero rows — a lost stamp is never a success", async () => {
  const { client } = makeFake({ data: null, error: null });
  assertEquals(await createDomainLeaseClient(client).stampAttached(ROW, ORG, TOKEN, "example.church", WINDOW), false);
});

// ── compensation read ───────────────────────────────────────────────────────

Deno.test("rowStillExists reads on (id, org_id) and reports presence", async () => {
  const present = makeFake({ data: { id: ROW }, error: null });
  assertEquals(await createDomainLeaseClient(present.client).rowStillExists(ROW, ORG), true);
  assert(has(present.recorded, "eq", "org_id", ORG));
  assert(has(present.recorded, "eq", "id", ROW));

  const gone = makeFake({ data: null, error: null });
  assertEquals(await createDomainLeaseClient(gone.client).rowStillExists(ROW, ORG), false);
});

// ── tombstone hard-delete ───────────────────────────────────────────────────

Deno.test("hardDeleteRemoved uses the full fenced predicate and an exact count", async () => {
  const { client, recorded } = makeFake({ data: null, error: null, count: 1 });
  assertEquals(await createDomainLeaseClient(client).hardDeleteRemoved(ROW, ORG, TOKEN), true);
  assert(has(recorded, "delete", { count: "exact" }));
  assert(has(recorded, "eq", "id", ROW));
  assert(has(recorded, "eq", "org_id", ORG));
  assert(has(recorded, "eq", "status", "removing"));
  assert(has(recorded, "eq", "attach_claim_token", TOKEN));
});

Deno.test("hardDeleteRemoved is false on a zero count (stale token / state moved)", async () => {
  const zero = makeFake({ data: null, error: null, count: 0 });
  assertEquals(await createDomainLeaseClient(zero.client).hardDeleteRemoved(ROW, ORG, TOKEN), false);
  // A missing count is not a success either.
  const none = makeFake({ data: null, error: null });
  assertEquals(await createDomainLeaseClient(none.client).hardDeleteRemoved(ROW, ORG, TOKEN), false);
});
