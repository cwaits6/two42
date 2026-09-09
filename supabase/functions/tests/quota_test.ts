// Unit tests for the edge-side quota reserve. Pure
// units: no network, no database — the fakes below satisfy QuotaClient
// structurally. Mirrors lib/email/quota.test.ts's cases; a contract change
// lands on both sides.

import { assertEquals } from "jsr:@std/assert@1";
import { reserveEmailQuota, type QuotaClient } from "../_shared/quota.ts";

const ORG_ID = "11111111-2222-3333-4444-555555555555";

interface RecordedCall {
  fn?: string;
  args?: { _org_id: string; _n: number };
}

function makeFakeClient(result: {
  data: boolean | null;
  error: { message: string } | null;
}): { client: QuotaClient; recorded: RecordedCall } {
  const recorded: RecordedCall = {};
  const client: QuotaClient = {
    rpc(fn, args) {
      recorded.fn = fn;
      recorded.args = args;
      return Promise.resolve(result);
    },
  };
  return { client, recorded };
}

Deno.test("n = 0 short-circuits to true without calling the RPC", async () => {
  const { client, recorded } = makeFakeClient({ data: true, error: null });
  assertEquals(await reserveEmailQuota(client, ORG_ID, 0), true);
  assertEquals(recorded.fn, undefined);
});

Deno.test("negative n refuses (false) without calling the RPC", async () => {
  const { client, recorded } = makeFakeClient({ data: true, error: null });
  assertEquals(await reserveEmailQuota(client, ORG_ID, -3), false);
  assertEquals(recorded.fn, undefined);
});

Deno.test("a granted reservation returns true and passes org + batch size", async () => {
  const { client, recorded } = makeFakeClient({ data: true, error: null });
  assertEquals(await reserveEmailQuota(client, ORG_ID, 12), true);
  assertEquals(recorded.fn, "email_quota_consume");
  assertEquals(recorded.args, { _org_id: ORG_ID, _n: 12 });
});

Deno.test("a refused reservation (cap hit) returns false", async () => {
  const { client } = makeFakeClient({ data: false, error: null });
  assertEquals(await reserveEmailQuota(client, ORG_ID, 12), false);
});

Deno.test("an RPC error is a refusal (fail closed)", async () => {
  const { client } = makeFakeClient({ data: null, error: { message: "boom" } });
  assertEquals(await reserveEmailQuota(client, ORG_ID, 5), false);
});

Deno.test("a throwing RPC is a refusal, never a rethrow", async () => {
  const client: QuotaClient = {
    rpc() {
      return Promise.reject(new Error("network down"));
    },
  };
  assertEquals(await reserveEmailQuota(client, ORG_ID, 5), false);
});

Deno.test("null data with no error is a refusal, not a grant", async () => {
  const { client } = makeFakeClient({ data: null, error: null });
  assertEquals(await reserveEmailQuota(client, ORG_ID, 5), false);
});
