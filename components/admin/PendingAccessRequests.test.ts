// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const declined = vi.hoisted(() => ({
  rows: [{ id: "r1" }] as { id: string }[] | null,
  error: null as { code: string } | null,
  table: "",
  filters: [] as [string, unknown][],
  update: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: (table: string) => {
      declined.table = table;
      const chain = {
        update: (values: unknown) => {
          declined.update(values);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          declined.filters.push([column, value]);
          return chain;
        },
        select: async () => ({ data: declined.rows, error: declined.error }),
      };
      return chain;
    },
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
  declined.error = null;
  declined.table = "";
  declined.filters = [];
  declined.update.mockClear();
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

  it("takes a request someone else already reviewed off the list, once, when Approve finds it gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));

    await mount();
    await click("Approve");
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("This request was already reviewed.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("r1");
  });

  it("declines only a request still pending, as denied, under the reviewer's name", async () => {
    await mount();
    await click("Decline");
    expect(declined.update).not.toHaveBeenCalled();

    await click("Decline request");
    expect(declined.table).toBe("access_requests");
    expect(declined.update).toHaveBeenCalledExactlyOnceWith({
      status: "denied",
      reviewed_by: "me",
      reviewed_at: expect.any(String),
    });
    expect(declined.filters).toEqual([
      ["id", "r1"],
      ["status", "pending"],
    ]);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Request declined.");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("r1");
    expect(document.body.textContent).not.toContain("Decline Cy Park's request?");
  });

  it("keeps the request, and the question, when the decline fails", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    declined.rows = null;
    declined.error = { code: "XX000" };

    await mount();
    await click("Decline");
    await click("Decline request");
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Couldn't decline the request. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Decline Cy Park's request?");
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({ what: "Failed to decline an access request", code: "XX000" }),
    ]);
    logged.mockRestore();
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
