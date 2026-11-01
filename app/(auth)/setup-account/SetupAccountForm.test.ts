// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSession = vi.fn(async () => ({ data: { session: null } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession } }) }));
const router = { replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=abc"),
  useRouter: () => router,
}));

const { SetupAccountForm } = await import("./SetupAccountForm");

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
  vi.unstubAllGlobals();
});

async function render(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  await act(async () => root.render(createElement(SetupAccountForm)));
}

describe("SetupAccountForm verification", () => {
  it("offers a retry when the request never gets an answer", async () => {
    await render(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it("offers a retry when the answer is not readable", async () => {
    await render(async () => new Response("<html>", { status: 200 }));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it("offers a retry when the session check fails on a used link", async () => {
    getSession.mockRejectedValueOnce(new Error("storage unavailable"));
    await render(async () => new Response(null, { status: 404 }));
    expect(container.textContent).toContain("Couldn't load this signup link");
  });

  it("shows the dead-link message for a used link with no session", async () => {
    await render(async () => new Response(null, { status: 404 }));
    expect(container.textContent).toContain("This link isn't valid anymore");
    expect(container.textContent).toContain("Ask a church admin for a new one.");
  });
});
