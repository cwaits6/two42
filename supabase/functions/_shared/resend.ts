// One POST to Resend's send endpoint, answered as a SendOutcome. With an
// idempotency key Resend processes a request once for 24 hours: a retry with
// the same key and body answers with the first send's id, and one with a
// different body is a 409 "invalid_idempotent_request", which still means
// the first send went out. A 409 "concurrent_idempotent_requests" means the
// first is still in flight. Any other refusal, and a request that never
// left, is retried by a later firing.
//
// Deliberately free of any supabase-js import, and given its fetch, so it
// can be unit tested offline without a network.

import type { SendOutcome } from "./serving-hourly.ts";

const RESEND_SEND_URL = "https://api.resend.com/emails";

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

/** Maps Resend's answer to what the caller does next. */
export function resendOutcome(status: number, body: string): SendOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 429) return "rate_limited";
  if (status === 409 && body.includes("invalid_idempotent_request")) return "sent";
  return "retry";
}

export async function sendThroughResend(
  send: ResendSend,
  fetchFn: typeof fetch = fetch,
): Promise<SendOutcome> {
  try {
    const res = await fetchFn(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${send.apiKey}`,
        "Content-Type": "application/json",
        ...(send.idempotencyKey ? { "Idempotency-Key": send.idempotencyKey } : {}),
      },
      body: JSON.stringify(send.payload),
    });
    if (res.ok) return "sent";
    // The profile id, not the email address (PII) — the Resend error body
    // is what's actionable here.
    const body = await res.text();
    console.error("Resend error for profile", send.refId, res.status, body);
    return resendOutcome(res.status, body);
  } catch (err) {
    console.error("Resend request failed for profile", send.refId, err);
    return "retry";
  }
}
