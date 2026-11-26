// The retry policy both the app and the edge functions send under.

import { assertEquals } from "jsr:@std/assert@1";
import { MAX_RETRY_WAIT_MS, MAX_SEND_ATTEMPTS, rateLimitWaitMs } from "../_shared/rate-limit.ts";

const LIMITED = { status: 429, name: "rate_limit_exceeded", retryAfter: "2" };

Deno.test("a rate limit waits the time Resend states", () => {
  assertEquals(rateLimitWaitMs(1, LIMITED), 2000);
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, name: null }), 2000);
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, status: null }), 2000);
});

Deno.test("a rate limit waits a second when Resend states no usable time", () => {
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, retryAfter: null }), 1000);
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, retryAfter: "soon" }), 1000);
});

Deno.test("a stated wait past the bound is not waited", () => {
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, retryAfter: String(MAX_RETRY_WAIT_MS / 1000) }), MAX_RETRY_WAIT_MS);
  assertEquals(rateLimitWaitMs(1, { ...LIMITED, retryAfter: String(MAX_RETRY_WAIT_MS / 1000 + 1) }), null);
});

Deno.test("the last try is not followed by another", () => {
  assertEquals(rateLimitWaitMs(MAX_SEND_ATTEMPTS - 1, LIMITED), 2000);
  assertEquals(rateLimitWaitMs(MAX_SEND_ATTEMPTS, LIMITED), null);
});

for (const name of ["daily_quota_exceeded", "monthly_quota_exceeded"]) {
  Deno.test(`a ${name} is never retried`, () => {
    assertEquals(rateLimitWaitMs(1, { status: 429, name, retryAfter: "1" }), null);
  });
}

Deno.test("any other refusal is not retried", () => {
  assertEquals(rateLimitWaitMs(1, { status: 500, name: null, retryAfter: "1" }), null);
  assertEquals(rateLimitWaitMs(1, { status: 422, name: "validation_error", retryAfter: null }), null);
});
