// Unit tests for the Vercel response classifiers. Pure units over a
// (status, body) pair — the fetch layer in createVercelClient() funnels every
// response through these, so this is where the error-code semantics the
// worker relies on are pinned. The token does not exist yet, so the shapes
// below come from Vercel's REST reference, not from live responses; an
// unrecognised status must degrade to "ambiguous"/"error", never to a
// confident success.

import { assertEquals } from "jsr:@std/assert@1";
import {
  classifyAddResponse,
  classifyGetResponse,
  classifyRemoveResponse,
} from "../_shared/vercel.ts";

// ── add ─────────────────────────────────────────────────────────────────────

Deno.test("add: 200 with verified:true is added", () => {
  assertEquals(classifyAddResponse(200, { name: "example.church", verified: true }), { kind: "added" });
});

Deno.test("add: 200 without a verified flag is added (shape tolerance)", () => {
  assertEquals(classifyAddResponse(200, { name: "example.church" }), { kind: "added" });
  assertEquals(classifyAddResponse(201, null), { kind: "added" });
});

Deno.test("add: 200 with verified:false is a permanent ownership challenge, not a success", () => {
  const r = classifyAddResponse(200, {
    name: "example.church",
    verified: false,
    verification: [{ type: "TXT", domain: "_vercel.example.church", value: "vc-domain-verify=..." }],
  });
  assertEquals(r.kind, "permanent");
  if (r.kind === "permanent") assertEquals(r.reason, "ownership_challenge");
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

Deno.test("get: 200 verified:false is pending_verification — never attached", () => {
  assertEquals(classifyGetResponse(200, { name: "example.church", verified: false }), { kind: "pending_verification" });
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
