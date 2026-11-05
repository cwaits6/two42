// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const declined = vi.hoisted(() => ({ rows: [{ id: "r1" }] as { id: string }[] }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ select: async () => ({ data: declined.rows, error: null }) }) }),
      }),
    }),
  }),
}));

const { PendingAccessRequests } = await import("./PendingAccessRequests");

const REQUEST = {
  id: "r1",
  name: "Cy Park",
  email: "cy@example.test",
  message: null,
  created_at: "2026-10-01T12:00:00Z",
};

let root: Root;
const onRemove = vi.fn();

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(PendingAccessRequests, { requests: [REQUEST], onRemove, timeZone: "America/Chicago" }),
    );
  });
}

// The confirmation renders after the queue, so the last match is its button.
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].findLast((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

const click = (name: string) => act(async () => button(name).click());

beforeEach(() => {
  declined.rows = [{ id: "r1" }];
  onRemove.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PendingAccessRequests", () => {
  it("sends Approve once however many times it is pressed", async () => {
    let settle: (response: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((resolve) => (settle = resolve)));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    await click("Approve");
    expect(button("Approve").disabled).toBe(true);
    expect(button("Decline").disabled).toBe(true);
    await click("Approve");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/approve",
      expect.objectContaining({ body: JSON.stringify({ email: "cy@example.test", name: "Cy Park" }) }),
    );

    await act(async () => settle({ ok: true, status: 200 }));
    expect(toast.success).toHaveBeenCalledWith("Request approved.");
    expect(onRemove).toHaveBeenCalledWith("r1");
  });

  it("keeps the request listed when the approval fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));

    await mount();
    await click("Approve");
    expect(toast.error).toHaveBeenCalledOnce();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("asks before declining, and does not report a decline that matched no row", async () => {
    declined.rows = [];
    await mount();
    await click("Decline");
    expect(document.body.textContent).toContain("Decline Cy Park's request?");
    expect(onRemove).not.toHaveBeenCalled();

    await click("Decline request");
    expect(toast.error).toHaveBeenCalledWith("This request was already reviewed.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledWith("r1");
  });
});
