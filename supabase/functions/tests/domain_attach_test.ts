// Unit tests for the worker's orchestration. Pure units: the fakes below
// satisfy DomainLeaseClient and VercelClient structurally, so every branch
// of the attach and detach loops — lease races, permanent failures,
// reconcile-before-re-POST, compensation for a lost stamp, idempotent
// detach — runs with no network and no database.

import { assertEquals } from "jsr:@std/assert@1";
import { attachDomainsForOrg, detachDomainsForOrg } from "../_shared/domain-attach.ts";
import type { DomainLeaseClient, DomainRow } from "../_shared/domain-lease.ts";
import type {
  VercelAddResult,
  VercelClient,
  VercelGetResult,
  VercelRemoveResult,
} from "../_shared/vercel.ts";

const ORG = { id: "11111111-2222-3333-4444-555555555555" };
const APEX = "two42.io";
const WINDOW = 10 * 60 * 1000;
const TOKEN = "99999999-8888-7777-6666-555555555555";
const ROW: DomainRow = { id: "row-1", domain: "example.church" };

interface LeaseCalls {
  claimAttach: string[];
  claimDetach: string[];
  stamp: Array<{ id: string; token: string; domain: string }>;
  reread: string[];
  hardDelete: Array<{ id: string; token: string }>;
}

function fakeLease(opts: {
  verified?: DomainRow[];
  removing?: DomainRow[];
  claimAttach?: string | null;
  claimDetach?: string | null;
  stamp?: boolean;
  exists?: boolean;
  hardDelete?: boolean;
}): { lease: DomainLeaseClient; calls: LeaseCalls } {
  const calls: LeaseCalls = { claimAttach: [], claimDetach: [], stamp: [], reread: [], hardDelete: [] };
  const lease: DomainLeaseClient = {
    listVerifiedUnattached: () => Promise.resolve(opts.verified ?? []),
    listRemoving: () => Promise.resolve(opts.removing ?? []),
    claimAttachLease(id) {
      calls.claimAttach.push(id);
      return Promise.resolve(opts.claimAttach === undefined ? TOKEN : opts.claimAttach);
    },
    claimDetachLease(id) {
      calls.claimDetach.push(id);
      return Promise.resolve(opts.claimDetach === undefined ? TOKEN : opts.claimDetach);
    },
    stampAttached(id, _orgId, token, domain) {
      calls.stamp.push({ id, token, domain });
      return Promise.resolve(opts.stamp ?? true);
    },
    rowStillExists(id) {
      calls.reread.push(id);
      return Promise.resolve(opts.exists ?? true);
    },
    hardDeleteRemoved(id, _orgId, token) {
      calls.hardDelete.push({ id, token });
      return Promise.resolve(opts.hardDelete ?? true);
    },
  };
  return { lease, calls };
}

interface VercelCalls {
  add: string[];
  get: string[];
  remove: string[];
}

function fakeVercel(opts: {
  add?: VercelAddResult;
  get?: VercelGetResult;
  remove?: VercelRemoveResult;
}): { vercel: VercelClient; calls: VercelCalls } {
  const calls: VercelCalls = { add: [], get: [], remove: [] };
  const vercel: VercelClient = {
    addDomain(domain) {
      calls.add.push(domain);
      return Promise.resolve(opts.add ?? { kind: "added" });
    },
    getDomain(domain) {
      calls.get.push(domain);
      return Promise.resolve(opts.get ?? { kind: "attached" });
    },
    removeDomain(domain) {
      calls.remove.push(domain);
      return Promise.resolve(opts.remove ?? { kind: "removed" });
    },
  };
  return { vercel, calls };
}

// ── attach ──────────────────────────────────────────────────────────────────

Deno.test("attach: no verified-unattached rows is a clean no-op", async () => {
  const { lease } = fakeLease({});
  const { vercel, calls } = fakeVercel({});
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 0, sendFailures: 0 });
  assertEquals(calls.add, []);
});

Deno.test("attach: lease lost — zero Vercel calls, zero stamps, not a failure", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW], claimAttach: null });
  const { vercel, calls } = fakeVercel({});
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 0, sendFailures: 0 });
  assertEquals(lc.claimAttach, ["row-1"]);
  assertEquals(calls.add, []);
  assertEquals(lc.stamp, []);
});

Deno.test("attach: clean add → stamp with the claim token and the claimed domain → sent = 1", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel, calls } = fakeVercel({ add: { kind: "added" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 1, sendFailures: 0 });
  assertEquals(calls.add, ["example.church"]);
  assertEquals(calls.get, []);
  assertEquals(lc.stamp, [{ id: "row-1", token: TOKEN, domain: "example.church" }]);
});

Deno.test("attach: already_exists → GET confirms attached → stamped", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel, calls } = fakeVercel({ add: { kind: "already_exists" }, get: { kind: "attached" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 1, sendFailures: 0 });
  assertEquals(calls.get, ["example.church"]);
  assertEquals(lc.stamp.length, 1);
});

Deno.test("attach: already_exists but GET finds nothing → no stamp, reported", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel } = fakeVercel({ add: { kind: "already_exists" }, get: { kind: "not_attached" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sent, 0);
  assertEquals(r.sendFailures, 1);
  assertEquals(r.itemFailures?.[0].item, "row-1");
  assertEquals(lc.stamp, []);
});

for (const reason of ["conflict", "forbidden", "payment_required", "ownership_challenge"] as const) {
  Deno.test(`attach: permanent ${reason} → no GET, no stamp, one item failure`, async () => {
    const { lease, calls: lc } = fakeLease({ verified: [ROW] });
    const { vercel, calls } = fakeVercel({ add: { kind: "permanent", reason, status: 409, detail: "d" } });
    const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
    assertEquals(r.sent, 0);
    assertEquals(r.sendFailures, 1);
    assertEquals(r.itemFailures, [{ item: "row-1", error: `vercel ${reason}: d` }]);
    assertEquals(calls.get, []);
    assertEquals(lc.stamp, []);
    assertEquals(lc.reread, []);
  });
}

Deno.test("attach: ambiguous → GET-reconcile before anything; attached → stamped, no re-POST", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel, calls } = fakeVercel({ add: { kind: "ambiguous", status: 0, detail: "timeout" }, get: { kind: "attached" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 1, sendFailures: 0 });
  assertEquals(calls.add, ["example.church"]);
  assertEquals(calls.get, ["example.church"]);
  assertEquals(lc.stamp.length, 1);
});

Deno.test("attach: ambiguous → GET says not attached → no stamp, no re-POST, reported for the next run", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel, calls } = fakeVercel({ add: { kind: "ambiguous", status: 502, detail: "status 502" }, get: { kind: "not_attached" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sent, 0);
  assertEquals(r.sendFailures, 1);
  assertEquals(calls.add.length, 1);
  assertEquals(lc.stamp, []);
});

Deno.test("attach: ambiguous → GET says pending_verification → never stamped, reported permanent", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel } = fakeVercel({ add: { kind: "ambiguous", status: 0, detail: "t" }, get: { kind: "pending_verification" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sendFailures, 1);
  assertEquals(lc.stamp, []);
});

Deno.test("attach: ambiguous → GET errors → no stamp, reported", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW] });
  const { vercel } = fakeVercel({ add: { kind: "ambiguous", status: 429, detail: "rate" }, get: { kind: "error", status: 429, detail: "rate" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sendFailures, 1);
  assertEquals(lc.stamp, []);
});

Deno.test("attach: compensation — stamp lost AND row gone → detach the name just attached", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW], stamp: false, exists: false });
  const { vercel, calls } = fakeVercel({ add: { kind: "added" }, remove: { kind: "removed" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 0, sendFailures: 0 });
  assertEquals(lc.reread, ["row-1"]);
  assertEquals(calls.remove, ["example.church"]);
});

Deno.test("attach: compensation — stamp lost but row present → leave it, no detach", async () => {
  const { lease, calls: lc } = fakeLease({ verified: [ROW], stamp: false, exists: true });
  const { vercel, calls } = fakeVercel({ add: { kind: "added" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r, { sent: 0, sendFailures: 0 });
  assertEquals(lc.reread, ["row-1"]);
  assertEquals(calls.remove, []);
});

Deno.test("attach: compensation detach that itself fails is reported", async () => {
  const { lease } = fakeLease({ verified: [ROW], stamp: false, exists: false });
  const { vercel } = fakeVercel({ add: { kind: "added" }, remove: { kind: "error", status: 500, detail: "s" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sendFailures, 1);
});

Deno.test("attach: denylisted apex/subdomain is refused before any lease or Vercel call", async () => {
  const rows: DomainRow[] = [
    { id: "apex", domain: "two42.io" },
    { id: "sub", domain: "grace.two42.io" },
    { id: "ok", domain: "example.church" },
  ];
  const { lease, calls: lc } = fakeLease({ verified: rows });
  const { vercel, calls } = fakeVercel({});
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sent, 1);
  assertEquals(r.sendFailures, 2);
  assertEquals(r.itemFailures?.map((f) => f.item), ["apex", "sub"]);
  assertEquals(lc.claimAttach, ["ok"]);
  assertEquals(calls.add, ["example.church"]);
});

Deno.test("attach: a thrown lease/Vercel error isolates to the row, and the loop continues", async () => {
  const rows: DomainRow[] = [{ id: "bad", domain: "bad.example" }, { id: "good", domain: "good.example" }];
  const { lease, calls: lc } = fakeLease({ verified: rows });
  lease.claimAttachLease = (id) => {
    lc.claimAttach.push(id);
    return id === "bad" ? Promise.reject(new Error("db down")) : Promise.resolve(TOKEN);
  };
  const { vercel } = fakeVercel({});
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.sent, 1);
  assertEquals(r.itemFailures, [{ item: "bad", error: "db down" }]);
});

Deno.test("attach: itemFailures name the row id, never the domain", async () => {
  const { lease } = fakeLease({ verified: [ROW] });
  const { vercel } = fakeVercel({ add: { kind: "permanent", reason: "conflict", status: 409, detail: "d" } });
  const r = await attachDomainsForOrg(lease, vercel, ORG, APEX, WINDOW);
  assertEquals(r.itemFailures?.[0].item, "row-1");
});

// ── detach ──────────────────────────────────────────────────────────────────

Deno.test("detach: removed → hard-delete with the claim token → sent = 1", async () => {
  const { lease, calls: lc } = fakeLease({ removing: [ROW] });
  const { vercel, calls } = fakeVercel({ remove: { kind: "removed" } });
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r, { sent: 1, sendFailures: 0 });
  assertEquals(calls.remove, ["example.church"]);
  assertEquals(lc.hardDelete, [{ id: "row-1", token: TOKEN }]);
});

Deno.test("detach: not_found is idempotent success → hard-delete still runs", async () => {
  const { lease, calls: lc } = fakeLease({ removing: [ROW] });
  const { vercel } = fakeVercel({ remove: { kind: "not_found" } });
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r, { sent: 1, sendFailures: 0 });
  assertEquals(lc.hardDelete.length, 1);
});

Deno.test("detach: Vercel error → tombstone kept (no hard-delete), reported", async () => {
  const { lease, calls: lc } = fakeLease({ removing: [ROW] });
  const { vercel } = fakeVercel({ remove: { kind: "error", status: 409, detail: "transferring" } });
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r.sent, 0);
  assertEquals(r.sendFailures, 1);
  assertEquals(lc.hardDelete, []);
});

Deno.test("detach: lease lost → no Vercel call", async () => {
  const { lease } = fakeLease({ removing: [ROW], claimDetach: null });
  const { vercel, calls } = fakeVercel({});
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r, { sent: 0, sendFailures: 0 });
  assertEquals(calls.remove, []);
});

Deno.test("detach: hard-delete affecting zero rows is a failure, not a success", async () => {
  const { lease } = fakeLease({ removing: [ROW], hardDelete: false });
  const { vercel } = fakeVercel({ remove: { kind: "removed" } });
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r.sent, 0);
  assertEquals(r.sendFailures, 1);
  assertEquals(r.itemFailures?.[0].error, "tombstone hard-delete affected zero rows");
});

Deno.test("detach: a thrown lease/Vercel error isolates to the row, and the loop continues", async () => {
  // Symmetric with the attach-side isolation test above: the try/catch
  // around detachDomainsForOrg's loop body has the identical shape, and a
  // future refactor could accidentally break one without the other.
  const rows: DomainRow[] = [{ id: "bad", domain: "bad.example" }, { id: "good", domain: "good.example" }];
  const { lease, calls: lc } = fakeLease({ removing: rows });
  lease.claimDetachLease = (id) => {
    lc.claimDetach.push(id);
    return id === "bad" ? Promise.reject(new Error("db down")) : Promise.resolve(TOKEN);
  };
  const { vercel } = fakeVercel({ remove: { kind: "removed" } });
  const r = await detachDomainsForOrg(lease, vercel, ORG, WINDOW);
  assertEquals(r.sent, 1);
  assertEquals(r.itemFailures, [{ item: "bad", error: "db down" }]);
});
