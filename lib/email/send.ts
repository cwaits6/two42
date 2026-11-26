// Every email the app sends goes through sendEmail(). When Resend answers a
// rate limit, the same request goes again after the wait Resend states, under
// the same idempotency key, so Resend sends it once however many tries it
// takes. A daily or monthly quota is a 429 too, but waiting a second does not
// lift it, so it is answered as the failure it is. The edge functions'
// sendThroughResend() in supabase/functions/_shared/resend.ts does the same.

import { randomUUID } from "node:crypto";
import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";

/** Tries in all, the first send included. */
export const MAX_SEND_ATTEMPTS = 3;
/** The longest wait worth taking inside a request; a longer stated wait fails the send. */
export const MAX_RETRY_WAIT_MS = 5_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;

const QUOTA_ERRORS: ReadonlySet<string> = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

/** How long to wait before sending again, or null when the refusal is not a rate limit worth waiting out. */
export function rateLimitWaitMs(error: Pick<ErrorResponse, "name" | "statusCode">, headers: Record<string, string> | null): number | null {
  if (QUOTA_ERRORS.has(error.name)) return null;
  if (error.name !== "rate_limit_exceeded" && error.statusCode !== 429) return null;
  const stated = Number(headers?.["retry-after"]);
  const wait = Number.isFinite(stated) && stated >= 0 ? stated * 1000 : DEFAULT_RETRY_WAIT_MS;
  return wait <= MAX_RETRY_WAIT_MS ? wait : null;
}

export interface SendDeps {
  emails?: Pick<Resend["emails"], "send">;
  sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends one email; the error is Resend's last answer, or null once it is sent. */
export async function sendEmail(
  payload: CreateEmailOptions,
  deps: SendDeps = {},
): Promise<{ error: ErrorResponse | null }> {
  const emails = deps.emails ?? new Resend(process.env.RESEND_API_KEY).emails;
  const sleep = deps.sleep ?? pause;
  const idempotencyKey = randomUUID();
  for (let attempt = 1; ; attempt++) {
    const { error, headers } = await emails.send(payload, { idempotencyKey });
    if (!error) return { error: null };
    const wait = attempt < MAX_SEND_ATTEMPTS ? rateLimitWaitMs(error, headers ?? null) : null;
    if (wait === null) return { error };
    await sleep(wait);
  }
}
