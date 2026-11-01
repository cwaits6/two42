// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Answer = { error: { status?: number } | null };
let answers: Answer[];
const resetPasswordForEmail = vi.fn(async () => answers.shift() ?? { error: null });
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { resetPasswordForEmail } }),
}));

const { ForgotPasswordForm } = await import("./ForgotPasswordForm");

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function submit(email: string) {
  await act(async () => root.render(createElement(ForgotPasswordForm)));
  container.querySelector<HTMLInputElement>("#email")!.value = email;
  await act(async () => container.querySelector("form")!.requestSubmit());
}

async function sendAgain() {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Send again");
  await act(async () => button!.click());
}

const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;
const SENT_AGAIN = "If an account uses this email, another link is on its way.";
const statusText = () => container.querySelector('[role="status"]')?.textContent ?? null;

describe("ForgotPasswordForm", () => {
  it("stays on the form and says the send failed when auth is unreachable", async () => {
    answers = [{ error: {} }];
    await submit("ada@example.com");
    expect(alertText()).toMatch(/^Couldn't send the link\./);
    expect(container.textContent).not.toContain("Check your email");
  });

  it("answers a rate-limited send exactly like a sent one", async () => {
    answers = [{ error: { status: 429 } }, { error: { status: 429 } }];
    await submit("ada@example.com");
    expect(container.textContent).toContain("Check your email");
    expect(alertText()).toBeNull();

    await sendAgain();
    expect(statusText()).toBe(SENT_AGAIN);
    expect(alertText()).toBeNull();
  });

  it("reports a 4xx other than the rate limit: no mail went out", async () => {
    answers = [{ error: { status: 400 } }];
    await submit("ada@example.com");
    expect(container.textContent).not.toContain("Check your email");
    expect(alertText()).not.toBeNull();
  });

  it("names the address once the link is sent", async () => {
    answers = [{ error: null }];
    await submit("ada@example.com");
    expect(container.textContent).toContain("Check your email");
    expect(container.textContent).toContain("ada@example.com");
    expect(alertText()).toBeNull();
  });

  it("confirms a resend only when it was not lost to an outage", async () => {
    answers = [{ error: null }, { error: { status: 503 } }, { error: null }];
    await submit("ada@example.com");

    await sendAgain();
    expect(statusText()).toBeNull();
    expect(alertText()).toMatch(/^Couldn't send the link\./);

    await sendAgain();
    expect(statusText()).toBe(SENT_AGAIN);
    expect(alertText()).toBeNull();
  });
});
