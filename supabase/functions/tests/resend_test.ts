// How Resend's answers become the outcomes the hourly run acts on, and the
// header that lets a stranded reminder be retried without a second email.

import { assertEquals } from "jsr:@std/assert@1";
import {
  eventReminderIdempotencyKey,
  resendOutcome,
  sendThroughResend,
  servingReminderIdempotencyKey,
} from "../_shared/resend.ts";

const SEND = { apiKey: "re_test", payload: { to: "ann@example.test" }, refId: "ann" };

function answering(status: number, body = "") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

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

Deno.test("no key means no header", async () => {
  const { fetchFn, calls } = answering(200);
  await sendThroughResend(SEND, fetchFn);
  assertEquals(new Headers(calls[0].init.headers).has("Idempotency-Key"), false);
});

Deno.test("a rate limit stops the firing rather than retrying", async () => {
  const { fetchFn } = answering(429, '{"name":"rate_limit_exceeded"}');
  assertEquals(await sendThroughResend(SEND, fetchFn), "rate_limited");
});

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
