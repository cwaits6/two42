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
const statusText = () => container.querySelector('[role="status"]')?.textContent ?? null;

describe("ForgotPasswordForm", () => {
  it("stays on the form and says the send failed when it is refused", async () => {
    answers = [{ error: { status: 429 } }];
    await submit("ada@example.com");
    expect(alertText()).toBe("Couldn't send the link. Wait a minute, then try again.");
    expect(container.textContent).not.toContain("Check your email");
  });

  it("names the address once the link is sent", async () => {
    answers = [{ error: null }];
    await submit("ada@example.com");
    expect(container.textContent).toContain("Check your email");
    expect(container.textContent).toContain("ada@example.com");
    expect(alertText()).toBeNull();
  });

  it("says Sent again only when the resend goes through", async () => {
    answers = [{ error: null }, { error: { status: 429 } }, { error: null }];
    await submit("ada@example.com");

    await sendAgain();
    expect(statusText()).toBeNull();
    expect(alertText()).toBe("Couldn't send the link. Wait a minute, then try again.");

    await sendAgain();
    expect(statusText()).toBe("Sent again.");
    expect(alertText()).toBeNull();
  });
});
