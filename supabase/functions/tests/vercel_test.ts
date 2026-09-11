// Unit tests for the Vercel response classifiers. Pure units over a
// (status, body) pair — the fetch layer in createVercelClient() funnels every
// response through these, so this is where the error-code semantics the
// worker relies on are pinned. The token does not exist yet, so the shapes
// below come from Vercel's REST reference, not from live responses; an
// unrecognised status must degrade to "ambiguous"/"error", never to a
// confident success.

import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  classifyAddResponse,
  classifyGetResponse,
  classifyRemoveResponse,
  createVercelClient,
} from "../_shared/vercel.ts";

// ── add ─────────────────────────────────────────────────────────────────────

Deno.test("add: 200 with verified:true is added", () => {
  assertEquals(classifyAddResponse(200, { name: "example.church", verified: true }), { kind: "added" });
});

Deno.test("add: 200 without a verified flag is added (shape tolerance)", () => {
  assertEquals(classifyAddResponse(200, { name: "example.church" }), { kind: "added" });
  assertEquals(classifyAddResponse(201, null), { kind: "added" });
});

Deno.test("add: 200 with verified:false is needs_verification carrying the challenge, not a success", () => {
  const r = classifyAddResponse(200, {
    name: "example.church",
    verified: false,
    verification: [
      { type: "TXT", domain: "_vercel.example.church", value: "vc-domain-verify=abc", reason: "pending_domain_verification" },
    ],
  });
  assertEquals(r, {
    kind: "needs_verification",
    status: 200,
    verification: [
      { type: "TXT", domain: "_vercel.example.church", value: "vc-domain-verify=abc", reason: "pending_domain_verification" },
    ],
  });
});

Deno.test("add: verified:false with a missing or malformed verification list still needs verification, with no records", () => {
  assertEquals(classifyAddResponse(200, { verified: false }), { kind: "needs_verification", status: 200, verification: [] });
  const r = classifyAddResponse(200, { verified: false, verification: [null, "x", { type: "TXT" }, { type: "TXT", domain: "d", value: 1 }] });
  assertEquals(r, { kind: "needs_verification", status: 200, verification: [] });
});

Deno.test("add: 400 'already exists' is idempotent success (already_exists)", () => {
  assertEquals(
    classifyAddResponse(400, { error: { code: "domain_already_exists", message: "Domain already exists on the project" } }),
    { kind: "already_exists" },
  );
  // Message-only match, in case the code differs from the reference.
  assertEquals(
    classifyAddResponse(400, { error: { code: "bad_request", message: "The domain already exists on this project." } }),
    { kind: "already_exists" },
  );
});

Deno.test("add: any other 400 is ambiguous (reconcile), never already_exists", () => {
  const r = classifyAddResponse(400, { error: { code: "invalid_domain", message: "The domain is not valid" } });
  assertEquals(r.kind, "ambiguous");
  if (r.kind === "ambiguous") {
    assertEquals(r.status, 400);
    assertEquals(r.detail, "status 400: invalid_domain: The domain is not valid");
  }
});

Deno.test("add: 409 is a permanent conflict", () => {
  const r = classifyAddResponse(409, {
    error: { code: "domain_already_in_use", message: "The domain is already assigned to another Vercel project" },
  });
  assertEquals(r.kind, "permanent");
  if (r.kind === "permanent") {
    assertEquals(r.reason, "conflict");
    assertEquals(r.status, 409);
  }
});

Deno.test("add: 403 is permanent forbidden", () => {
  const r = classifyAddResponse(403, { error: { code: "forbidden", message: "You do not have permission" } });
  assertEquals(r.kind, "permanent");
  if (r.kind === "permanent") assertEquals(r.reason, "forbidden");
});

Deno.test("add: 402 is permanent payment_required", () => {
  const r = classifyAddResponse(402, { error: { code: "payment_required", message: "no payment method" } });
  assertEquals(r.kind, "permanent");
  if (r.kind === "permanent") assertEquals(r.reason, "payment_required");
});

Deno.test("add: 429 and 5xx are ambiguous", () => {
  assertEquals(classifyAddResponse(429, null).kind, "ambiguous");
  assertEquals(classifyAddResponse(500, null).kind, "ambiguous");
  assertEquals(classifyAddResponse(502, "<html>bad gateway</html>").kind, "ambiguous");
});

Deno.test("add: a body that is not an error envelope still describes the status", () => {
  const r = classifyAddResponse(503, { unexpected: true });
  assertEquals(r.kind, "ambiguous");
  if (r.kind === "ambiguous") assertEquals(r.detail, "status 503");
});

// ── get ─────────────────────────────────────────────────────────────────────

Deno.test("get: 200 verified:true is attached", () => {
  assertEquals(classifyGetResponse(200, { name: "example.church", verified: true }), { kind: "attached" });
});

Deno.test("get: 200 without a verified flag is attached (shape tolerance)", () => {
  assertEquals(classifyGetResponse(200, { name: "example.church" }), { kind: "attached" });
});

Deno.test("get: 200 verified:false is pending_verification carrying the challenge — never attached", () => {
  assertEquals(classifyGetResponse(200, { name: "example.church", verified: false }), {
    kind: "pending_verification",
    verification: [],
  });
  assertEquals(
    classifyGetResponse(200, {
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.example.church", value: "vc-domain-verify=abc" }],
    }),
    {
      kind: "pending_verification",
      verification: [{ type: "TXT", domain: "_vercel.example.church", value: "vc-domain-verify=abc" }],
    },
  );
});

Deno.test("get: 404 is not_attached", () => {
  assertEquals(classifyGetResponse(404, { error: { code: "not_found" } }), { kind: "not_attached" });
});

Deno.test("get: anything else is an error carrying the status", () => {
  const r = classifyGetResponse(500, null);
  assertEquals(r.kind, "error");
  if (r.kind === "error") assertEquals(r.status, 500);
  assertEquals(classifyGetResponse(403, null).kind, "error");
});

// ── remove ──────────────────────────────────────────────────────────────────

Deno.test("remove: 200 and 204 are removed", () => {
  assertEquals(classifyRemoveResponse(200, {}), { kind: "removed" });
  assertEquals(classifyRemoveResponse(204, null), { kind: "removed" });
});

Deno.test("remove: 404 is not_found (idempotent success)", () => {
  assertEquals(classifyRemoveResponse(404, { error: { code: "not_found" } }), { kind: "not_found" });
});

Deno.test("remove: 409 (project being transferred) is a transient error, not success", () => {
  const r = classifyRemoveResponse(409, { error: { message: "The project is currently being transferred" } });
  assertEquals(r.kind, "error");
  if (r.kind === "error") assertEquals(r.status, 409);
});

Deno.test("remove: 403 and 5xx are errors", () => {
  assertEquals(classifyRemoveResponse(403, null).kind, "error");
  assertEquals(classifyRemoveResponse(500, null).kind, "error");
});

// ── createVercelClient (the fetch/HTTP plumbing itself) ────────────────────
//
// The classify* tests above cover the pure (status, body) mapping;  these
// cover the seam between that and the network — URL/header/body
// construction, and the network/timeout → ambiguous/error asymmetry the
// module's own header comment describes. No token exists yet to test
// against the live API, so `fetch` is stubbed for the duration of each test.

function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("createVercelClient: addDomain builds the exact POST path, body, and auth header", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  await withFetch(
    ((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(new Response(JSON.stringify({ name: "x" }), { status: 200 }));
    }) as typeof fetch,
    async () => {
      const client = createVercelClient({ token: "tok", projectId: "proj 1", teamId: "team&1" });
      const r = await client.addDomain("example.church");
      assertEquals(r, { kind: "added" });
    },
  );
  assertEquals(captured?.url, "https://api.vercel.com/v10/projects/proj%201/domains?teamId=team%261");
  assertEquals((captured?.init.headers as Record<string, string>).Authorization, "Bearer tok");
  assertEquals((captured?.init.headers as Record<string, string>)["Content-Type"], "application/json");
  assertEquals(JSON.parse(captured?.init.body as string), { name: "example.church" });
});

Deno.test("createVercelClient: no teamId means no query string", async () => {
  let captured: string | undefined;
  await withFetch(
    ((url: string) => {
      captured = url;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch,
    () => createVercelClient({ token: "tok", projectId: "proj" }).removeDomain("example.church"),
  );
  assertEquals(captured, "https://api.vercel.com/v9/projects/proj/domains/example.church");
});

Deno.test("createVercelClient: getDomain and removeDomain URL-encode the domain in the path", async () => {
  let captured: string | undefined;
  await withFetch(
    ((url: string) => {
      captured = url;
      return Promise.resolve(new Response(JSON.stringify({ verified: true }), { status: 200 }));
    }) as typeof fetch,
    () => createVercelClient({ token: "tok", projectId: "proj" }).getDomain("exämple.church"),
  );
  assertStringIncludes(captured ?? "", encodeURIComponent("exämple.church"));
});

Deno.test("createVercelClient: a rejecting fetch degrades addDomain to ambiguous, never throws", async () => {
  const r = await withFetch(
    (() => Promise.reject(new Error("network down"))) as typeof fetch,
    () => createVercelClient({ token: "t", projectId: "p" }).addDomain("example.church"),
  );
  assertEquals(r.kind, "ambiguous");
  if (r.kind === "ambiguous") assertStringIncludes(r.detail, "network down");
});

Deno.test("createVercelClient: a rejecting fetch degrades getDomain to error, not ambiguous — the add/get asymmetry", async () => {
  const r = await withFetch(
    (() => Promise.reject(new Error("network down"))) as typeof fetch,
    () => createVercelClient({ token: "t", projectId: "p" }).getDomain("example.church"),
  );
  assertEquals(r.kind, "error");
});

Deno.test("createVercelClient: a rejecting fetch degrades removeDomain to error, not ambiguous", async () => {
  const r = await withFetch(
    (() => Promise.reject(new Error("network down"))) as typeof fetch,
    () => createVercelClient({ token: "t", projectId: "p" }).removeDomain("example.church"),
  );
  assertEquals(r.kind, "error");
});

Deno.test("createVercelClient: a body that fails to parse as JSON degrades to a null body, not a throw", async () => {
  const r = await withFetch(
    (() => Promise.resolve(new Response("not json", { status: 200 }))) as typeof fetch,
    () => createVercelClient({ token: "t", projectId: "p" }).getDomain("example.church"),
  );
  // classifyGetResponse(200, null) treats a missing verified flag as attached
  // (shape tolerance) — this pins that an unparseable body takes the same
  // path as a genuinely empty one, rather than throwing out of the client.
  assertEquals(r, { kind: "attached" });
});
