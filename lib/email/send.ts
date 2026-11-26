// Every email the app sends goes through sendEmail(). When Resend answers a
// rate limit, the same request goes again after the wait Resend states, under
// the same idempotency key, so Resend sends it once however many tries it
// takes. When to try again is decided in supabase/functions/_shared/rate-limit.ts,
// which the edge functions share.

import { randomUUID } from "node:crypto";
import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";
import { rateLimitWaitMs } from "@/supabase/functions/_shared/rate-limit";

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
    const wait = rateLimitWaitMs(attempt, {
      status: error.statusCode,
      name: error.name,
      retryAfter: headers?.["retry-after"] ?? null,
    });
    if (wait === null) return { error };
    await sleep(wait);
  }
}
