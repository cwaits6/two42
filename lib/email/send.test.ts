import { describe, expect, it, vi } from "vitest";
import { MAX_RETRY_WAIT_MS, MAX_SEND_ATTEMPTS, rateLimitWaitMs, sendEmail } from "@/lib/email/send";

const PAYLOAD = { from: "Hillside <noreply@hillside.example>", to: "ann@example.test", subject: "Hi", html: "<p>Hi</p>" };

type Answer = { data: { id: string } | null; error: { name: string; statusCode: number | null; message: string } | null; headers: Record<string, string> | null };

const SENT: Answer = { data: { id: "e1" }, error: null, headers: null };
const RATE_LIMITED = (retryAfter?: string): Answer => ({
  data: null,
  error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many requests" },
  headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
});
const QUOTA = (name: string): Answer => ({ data: null, error: { name, statusCode: 429, message: "Quota" }, headers: { "retry-after": "1" } });

function resendAnswering(...answers: Answer[]) {
  const send = vi.fn((..._args: unknown[]) => Promise.resolve(answers.shift() ?? SENT));
  const sleep = vi.fn((_ms: number) => Promise.resolve());
  return { emails: { send } as never, send, sleep };
}

describe("sendEmail", () => {
  it("sends once when Resend accepts it", async () => {
    const r = resendAnswering(SENT);
    expect(await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep })).toEqual({ error: null });
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.sleep).not.toHaveBeenCalled();
  });

  it("waits the stated time after a rate limit and sends the same request again under the same key", async () => {
    const r = resendAnswering(RATE_LIMITED("2"), SENT);
    expect(await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep })).toEqual({ error: null });
    expect(r.sleep).toHaveBeenCalledExactlyOnceWith(2000);
    expect(r.send).toHaveBeenCalledTimes(2);
    const [first, second] = r.send.mock.calls;
    expect(second[0]).toBe(first[0]);
    expect((first[1] as { idempotencyKey: string }).idempotencyKey).toEqual(expect.any(String));
    expect(second[1]).toEqual(first[1]);
  });

  it("gives each email its own key", async () => {
    const r = resendAnswering(SENT, SENT);
    await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep });
    await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep });
    expect(r.send.mock.calls[0][1]).not.toEqual(r.send.mock.calls[1][1]);
  });

  it("stops after a bounded number of tries and answers the rate limit", async () => {
    const r = resendAnswering(...Array.from({ length: MAX_SEND_ATTEMPTS + 2 }, () => RATE_LIMITED("1")));
    const { error } = await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep });
    expect(error?.name).toBe("rate_limit_exceeded");
    expect(r.send).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
    expect(r.sleep).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS - 1);
  });

  it.each(["daily_quota_exceeded", "monthly_quota_exceeded"])("does not retry a %s", async (name) => {
    const r = resendAnswering(QUOTA(name));
    const { error } = await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep });
    expect(error?.name).toBe(name);
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.sleep).not.toHaveBeenCalled();
  });

  it("does not retry any other refusal", async () => {
    const r = resendAnswering({ data: null, error: { name: "validation_error", statusCode: 422, message: "Bad" }, headers: null });
    expect((await sendEmail(PAYLOAD, { emails: r.emails, sleep: r.sleep })).error?.name).toBe("validation_error");
    expect(r.send).toHaveBeenCalledTimes(1);
  });
});

describe("rateLimitWaitMs", () => {
  const limited = { name: "rate_limit_exceeded" as const, statusCode: 429 };

  it("waits a second when Resend states no time", () => {
    expect(rateLimitWaitMs(limited, null)).toBe(1000);
    expect(rateLimitWaitMs(limited, { "retry-after": "soon" })).toBe(1000);
  });

  it("refuses a stated wait longer than a request can hold", () => {
    expect(rateLimitWaitMs(limited, { "retry-after": String(MAX_RETRY_WAIT_MS / 1000) })).toBe(MAX_RETRY_WAIT_MS);
    expect(rateLimitWaitMs(limited, { "retry-after": String(MAX_RETRY_WAIT_MS / 1000 + 1) })).toBeNull();
  });
});
