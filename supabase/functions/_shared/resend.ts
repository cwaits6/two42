// One send to Resend's send endpoint, answered as a SendOutcome. With an
// idempotency key Resend processes a request once for 24 hours: a retry with
// the same key and body answers with the first send's id, and one with a
// different body is a 409 "invalid_idempotent_request", which still means
// the first send went out. A 409 "concurrent_idempotent_requests" means the
// first is still in flight. Any other refusal, and a request that never
// left or timed out, is retried by a later firing.
//
// A rate limit is waited out here: the same request goes again after the
// wait Resend states, under the same key, a bounded number of times. A daily
// or monthly quota is a 429 too, but a wait does not lift it, so it stops the
// firing like a rate limit that outlasted its tries. lib/email/send.ts does
// the same for the app.
//
// Deliberately free of any supabase-js import, and given its fetch, so it
// can be unit tested offline without a network.

import type { SendOutcome } from "./serving-hourly.ts";
import { logError } from "./log.ts";

const RESEND_SEND_URL = "https://api.resend.com/emails";
// Well under the hourly firing's budget, which is only checked between sends,
// so one stalled request can't outlast the firing and leave its rows claimed.
const RESEND_TIMEOUT_MS = 15_000;
/** Tries in all, the first send included. */
export const MAX_SEND_ATTEMPTS = 3;
/** The longest wait worth taking inside a firing; a longer stated wait stops it. */
export const MAX_RETRY_WAIT_MS = 5_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;
const QUOTA_ERRORS: ReadonlySet<string> = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

export interface ResendSend {
  apiKey: string;
  /** The request body, as Resend's REST API spells it (snake_case `reply_to`). */
  payload: Record<string, unknown>;
  /** Logged on a refusal in place of the address: the recipient's profile id. */
  refId: string;
  idempotencyKey?: string;
}

/** The key under which Resend deduplicates one person's reminder for one team and local send date. */
export function servingReminderIdempotencyKey(r: { teamId: string; sendDate: string; profileId: string }): string {
  return `serving-reminder/${r.teamId}/${r.sendDate}/${r.profileId}`;
}

/** The key under which Resend deduplicates one person's reminder for one date of an event. */
export function eventReminderIdempotencyKey(r: { eventId: string; occurrenceDate: string; profileId: string }): string {
  return `event-reminder/${r.eventId}/${r.occurrenceDate}/${r.profileId}`;
}

/** The key under which Resend deduplicates one person's reminder for one supper on one date. */
export function supperReminderIdempotencyKey(r: { supperId: string; supperDate: string; profileId: string }): string {
  return `supper-reminder/${r.supperId}/${r.supperDate}/${r.profileId}`;
}

/** Maps Resend's answer to what the caller does next. */
export function resendOutcome(status: number, body: string): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 429) return "rate_limited";
  if (status === 409 && body.includes("invalid_idempotent_request")) return "sent";
  return "retry";
}

function errorName(body: string): string | null {
  try {
    const name = (JSON.parse(body) as { name?: unknown })?.name;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

/** How long to wait before sending again, or null when the refusal is not a rate limit worth waiting out. */
export function rateLimitWaitMs(status: number, body: string, retryAfter: string | null): number | null {
  if (status !== 429) return null;
  const name = errorName(body);
  if (name && QUOTA_ERRORS.has(name)) return null;
  const stated = Number(retryAfter ?? undefined);
  const wait = Number.isFinite(stated) && stated >= 0 ? stated * 1000 : DEFAULT_RETRY_WAIT_MS;
  return wait <= MAX_RETRY_WAIT_MS ? wait : null;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function sendThroughResend(
  send: ResendSend,
  fetchFn: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = pause,
): Promise<SendOutcome> {
  // A send with no key of its own gets one, so a retried rate limit cannot send twice.
  const idempotencyKey = send.idempotencyKey ?? crypto.randomUUID();
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchFn(RESEND_SEND_URL, {
        method: "POST",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${send.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(send.payload),
      });
      if (res.ok) return "sent";
      const body = await res.text();
      const wait = attempt < MAX_SEND_ATTEMPTS ? rateLimitWaitMs(res.status, body, res.headers.get("retry-after")) : null;
      if (wait !== null) {
        await sleep(wait);
        continue;
      }
      logError("Resend error for profile", { status: res.status }, { ids: { profile: send.refId } });
      return resendOutcome(res.status, body);
    } catch (err) {
      logError("Resend request failed for profile", err, { ids: { profile: send.refId } });
      return "retry";
    }
  }
}
