// When a rate-limited email is sent again: the one policy for the app's
// sendEmail() (lib/email/send.ts) and the edge functions' sendThroughResend().
// lib/email imports this file, so it must stay free of imports.
//
// A daily or monthly quota is a 429 too, but waiting does not lift it, so it
// is never retried.

/** Tries in all, the first send included. */
export const MAX_SEND_ATTEMPTS = 3;
/** The longest wait worth taking inside a request or a firing; a longer stated wait fails the send. */
export const MAX_RETRY_WAIT_MS = 5_000;
const DEFAULT_RETRY_WAIT_MS = 1_000;
const QUOTA_ERRORS: ReadonlySet<string> = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

/**
 * How long to wait before the next try, or null when there is none: the refusal
 * is not a rate limit, it is a quota, the stated wait is too long, or `attempt`
 * (counting from 1) was the last.
 */
export function rateLimitWaitMs(
  attempt: number,
  refusal: { status: number | null; name: string | null; retryAfter: string | null },
): number | null {
  if (attempt >= MAX_SEND_ATTEMPTS) return null;
  if (refusal.name !== null && QUOTA_ERRORS.has(refusal.name)) return null;
  if (refusal.status !== 429 && refusal.name !== "rate_limit_exceeded") return null;
  const stated = Number(refusal.retryAfter ?? undefined);
  const wait = Number.isFinite(stated) && stated >= 0 ? stated * 1000 : DEFAULT_RETRY_WAIT_MS;
  return wait <= MAX_RETRY_WAIT_MS ? wait : null;
}
