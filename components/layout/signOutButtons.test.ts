// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignOutOutcome } from "@/lib/signOut";
import { buildAccount } from "./account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const signOutHere = vi.fn<() => Promise<SignOutOutcome>>();
vi.mock("@/lib/signOut", () => ({ signOutHere }));

const { AccountBlock } = await import("./AccountBlock");
const { SignOutButton } = await import("@/app/join/[token]/SignOutButton");

const account = buildAccount({
  profile: { first_name: "Isaac", last_name: "Seedly", preferred_name: null, role: "member" },
  email: "isaac@example.test",
  isOperator: false,
  photoUrl: null,
});

const KEPT: SignOutOutcome = { signedOut: false, message: "Couldn't sign out. Try again." };
const GONE_WITH_WARNING: SignOutOutcome = { signedOut: true, message: "Other devices may still be signed in." };

let root: Root;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  toastError.mockClear();
  signOutHere.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}

const click = (el: Element) =>
  act(async () => {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
  });

function byText(role: string, text: string) {
  const el = [...document.querySelectorAll(`[role="${role}"], ${role}`)].find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`No ${role} "${text}"`);
  return el;
}

async function signOutFromMenu() {
  await mount(createElement(AccountBlock, { account }));
  await click(document.querySelector('button[aria-label^="Account menu"]')!);
  await click(byText("menuitem", "Sign out"));
}

async function signOutFromButton() {
  await mount(createElement(SignOutButton));
  await click(byText("button", "Sign out"));
}

describe("the account menu's Sign out", () => {
  it("stays on the page and says why when this device is still signed in", async () => {
    signOutHere.mockResolvedValue(KEPT);
    await signOutFromMenu();
    expect(toastError).toHaveBeenCalledExactlyOnceWith(KEPT.message);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves for the front door once this device is signed out, with any warning", async () => {
    signOutHere.mockResolvedValue(GONE_WITH_WARNING);
    await signOutFromMenu();
    expect(toastError).toHaveBeenCalledExactlyOnceWith(GONE_WITH_WARNING.message);
    expect(push).toHaveBeenCalledExactlyOnceWith("/");
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("the page's Sign out button", () => {
  it("keeps the page as it is and says why when this device is still signed in", async () => {
    signOutHere.mockResolvedValue(KEPT);
    await signOutFromButton();
    expect(toastError).toHaveBeenCalledExactlyOnceWith(KEPT.message);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reloads the page once this device is signed out, with any warning", async () => {
    signOutHere.mockResolvedValue(GONE_WITH_WARNING);
    await signOutFromButton();
    expect(toastError).toHaveBeenCalledExactlyOnceWith(GONE_WITH_WARNING.message);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
