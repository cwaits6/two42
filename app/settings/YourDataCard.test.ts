// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YourDataCard } from "./YourDataCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const steps = vi.hoisted(() => [] as string[]);
const signOut = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (path: string) => steps.push(`push ${path}`),
    refresh: () => steps.push("refresh"),
  }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut } }) }));

let root: Root | null = null;
const fetchMock = vi.fn();

async function clickDelete() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(YourDataCard)));
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "Delete my account",
  );
  await act(async () => button!.click());
}

beforeEach(() => {
  steps.length = 0;
  signOut.mockReset();
  signOut.mockImplementation(async () => {
    steps.push("signOut");
    return { error: null };
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("YourDataCard: an account already gone", () => {
  // The middleware trusts the token's signature alone, so /login sends anyone still
  // holding a token to the dashboard, which reads "Waiting for approval".
  it.each([401, 404])("clears the browser's session before the sign-in page on a %d", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    await clickDelete();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(steps).toEqual(["signOut", "push /login", "refresh"]);
  });

  it("still goes to the sign-in page when clearing the session fails", async () => {
    signOut.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await clickDelete();
    expect(steps).toEqual(["push /login", "refresh"]);
  });
});
