// How Resend's answers become the outcomes the hourly run acts on, and the
// header that lets a stranded reminder be retried without a second email.

import { assertEquals } from "jsr:@std/assert@1";
import {
  eventReminderIdempotencyKey,
  resendOutcome,
  sendThroughResend,
  servingReminderIdempotencyKey,
} from "../_shared/resend.ts";
import { MAX_SEND_ATTEMPTS } from "../_shared/rate-limit.ts";

const SEND = { apiKey: "re_test", payload: { to: "ann@example.test" }, refId: "ann" };

function answering(status: number, body = "") {
  return answeringInTurn({ status, body });
}

/** Answers each request with the next of these, and the last one from then on. */
function answeringInTurn(...answers: Array<{ status: number; body?: string; retryAfter?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const { status, body = "", retryAfter } = answers[Math.min(calls.length, answers.length - 1)];
    calls.push({ url, init });
    const headers = retryAfter === undefined ? undefined : { "retry-after": retryAfter };
    return Promise.resolve(new Response(body, { status, headers }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: (ms: number) => (waits.push(ms), Promise.resolve()) };
}

const RATE_LIMITED = { status: 429, body: '{"name":"rate_limit_exceeded"}', retryAfter: "2" };

Deno.test("an accepted send is sent", async () => {
  const { fetchFn, calls } = answering(200, '{"id":"abc"}');
  assertEquals(await sendThroughResend({ ...SEND, idempotencyKey: "k" }, fetchFn), "sent");
  assertEquals(calls[0].url, "https://api.resend.com/emails");
  assertEquals(new Headers(calls[0].init.headers).get("Idempotency-Key"), "k");
  assertEquals(new Headers(calls[0].init.headers).get("Authorization"), "Bearer re_test");
  assertEquals(calls[0].init.body, JSON.stringify(SEND.payload));
});

Deno.test("a send can time out", async () => {
  const { fetchFn, calls } = answering(200);
  await sendThroughResend(SEND, fetchFn);
  assertEquals(calls[0].init.signal instanceof AbortSignal, true);
});

Deno.test("a send with no key of its own gets one", async () => {
  const { fetchFn, calls } = answering(200);
  await sendThroughResend(SEND, fetchFn);
  assertEquals(new Headers(calls[0].init.headers).get("Idempotency-Key")?.length, 36);
});

Deno.test("a rate limit is retried once after the stated wait, under the same key and body, and sent once", async () => {
  const { fetchFn, calls } = answeringInTurn(RATE_LIMITED, { status: 200, body: '{"id":"abc"}' });
  const { waits, sleep } = sleeper();
  assertEquals(await sendThroughResend({ ...SEND, idempotencyKey: "k" }, fetchFn, sleep), "sent");
  assertEquals(waits, [2000]);
  assertEquals(calls.length, 2);
  assertEquals(new Headers(calls[1].init.headers).get("Idempotency-Key"), "k");
  assertEquals(calls[1].init.body, calls[0].init.body);
});

Deno.test("a keyless send keeps its key across a retry", async () => {
  const { fetchFn, calls } = answeringInTurn(RATE_LIMITED, { status: 200 });
  await sendThroughResend(SEND, fetchFn, sleeper().sleep);
  const key = new Headers(calls[0].init.headers).get("Idempotency-Key");
  assertEquals(new Headers(calls[1].init.headers).get("Idempotency-Key"), key);
});

Deno.test("a rate limit that outlasts its tries stops the firing", async () => {
  const { fetchFn, calls } = answeringInTurn(RATE_LIMITED);
  const { waits, sleep } = sleeper();
  assertEquals(await sendThroughResend(SEND, fetchFn, sleep), "rate_limited");
  assertEquals(calls.length, MAX_SEND_ATTEMPTS);
  assertEquals(waits.length, MAX_SEND_ATTEMPTS - 1);
});

for (const name of ["daily_quota_exceeded", "monthly_quota_exceeded"]) {
  Deno.test(`a ${name} is not retried and stops the firing`, async () => {
    const { fetchFn, calls } = answeringInTurn({ status: 429, body: `{"name":"${name}"}`, retryAfter: "1" });
    const { waits, sleep } = sleeper();
    assertEquals(await sendThroughResend(SEND, fetchFn, sleep), "rate_limited");
    assertEquals(calls.length, 1);
    assertEquals(waits, []);
  });
}

Deno.test("a key whose first send went out with a different body counts as sent", async () => {
  const { fetchFn } = answering(409, '{"name":"invalid_idempotent_request"}');
  assertEquals(await sendThroughResend(SEND, fetchFn), "sent");
});

Deno.test("a key whose first send is still in flight is retried later", async () => {
  const { fetchFn } = answering(409, '{"name":"concurrent_idempotent_requests"}');
  assertEquals(await sendThroughResend(SEND, fetchFn), "retry");
});

Deno.test("any other refusal is retried later", async () => {
  const { fetchFn } = answering(500, "boom");
  assertEquals(await sendThroughResend(SEND, fetchFn), "retry");
  assertEquals(resendOutcome(400, '{"name":"validation_error"}'), "retry");
  assertEquals(resendOutcome(403, ""), "retry");
});

Deno.test("a request that never left is retried later", async () => {
  const fetchFn = (() => Promise.reject(new Error("dns"))) as unknown as typeof fetch;
  assertEquals(await sendThroughResend(SEND, fetchFn), "retry");
});

Deno.test("the idempotency key is the record's key, the same on every attempt", () => {
  const first = servingReminderIdempotencyKey({ teamId: "t1", sendDate: "2026-11-05", profileId: "ann" });
  const again = servingReminderIdempotencyKey({ teamId: "t1", sendDate: "2026-11-05", profileId: "ann" });
  assertEquals(first, again);
  assertEquals(first, "serving-reminder/t1/2026-11-05/ann");
  // A different local send date is a different reminder on purpose.
  assertEquals(servingReminderIdempotencyKey({ teamId: "t1", sendDate: "2026-11-07", profileId: "ann" }) === first, false);
});

Deno.test("an event reminder's key names the event, the date and the person", () => {
  const key = { eventId: "e1", occurrenceDate: "2026-11-05", profileId: "ann" };
  assertEquals(eventReminderIdempotencyKey(key), "event-reminder/e1/2026-11-05/ann");
  // The next date of the same series is a different reminder.
  assertEquals(eventReminderIdempotencyKey({ ...key, occurrenceDate: "2026-11-12" }) === eventReminderIdempotencyKey(key), false);
});
