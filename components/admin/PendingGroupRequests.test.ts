// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

type Failure = { code: string } | null;
const db = vi.hoisted(() => ({
  approveError: null as Failure,
  declined: { data: [{ id: "g1" }], error: null } as { data: { id: string }[] | null; error: Failure },
  rpc: vi.fn(),
  filters: [] as [string, unknown][],
  update: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    rpc: async (name: string, args: unknown) => {
      db.rpc(name, args);
      return { error: db.approveError };
    },
    from: () => {
      const chain = {
        update: (values: unknown) => {
          db.update(values);
          return chain;
        },
        eq: (column: string, value: unknown) => {
          db.filters.push([column, value]);
          return chain;
        },
        select: async () => db.declined,
      };
      return chain;
    },
  }),
}));

const { PendingGroupRequests } = await import("./PendingGroupRequests");

const REQUEST = {
  id: "g1",
  name: "Young families",
  description: null,
  created_at: "2026-10-01T12:00:00Z",
  requester: { first_name: "Cy", last_name: "Park", preferred_name: null },
};

let root: Root;
const onRemove = vi.fn();

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(PendingGroupRequests, {
        requests: [REQUEST] as never,
        onRemove,
        timeZone: "America/Chicago",
      }),
    );
  });
}

async function click(name: string) {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`No button named ${name}`);
  await act(async () => found.click());
}

beforeEach(() => {
  db.approveError = null;
  db.declined = { data: [{ id: "g1" }], error: null };
  db.filters = [];
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

describe("PendingGroupRequests", () => {
  it("approves through the database function and takes the request off the page", async () => {
    await mount();
    await click("Approve");

    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("group_request_approve", { _request_id: "g1" });
    expect(toast.success).toHaveBeenCalledWith("Group added. Cy Park leads it.");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("g1");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the request listed when the approval is refused for a reason other than being decided", async () => {
    db.approveError = { code: "GC001" };
    await mount();
    await click("Approve");

    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("takes an approval that was already decided off the page without claiming it", async () => {
    db.approveError = { code: "GC004" };
    await mount();
    await click("Approve");

    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("g1");
  });

  it("declines only a request that is still pending, and says so", async () => {
    await mount();
    await click("Decline");

    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: "declined", reviewed_by: "me" }));
    expect(db.filters).toEqual([
      ["id", "g1"],
      ["status", "pending"],
    ]);
    expect(toast.success).toHaveBeenCalledWith("Request declined.");
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("g1");
  });

  it("does not report a decline that matched no row", async () => {
    db.declined = { data: [], error: null };
    await mount();
    await click("Decline");

    expect(toast.error).toHaveBeenCalledWith("This request was already reviewed.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("g1");
  });

  it("keeps the request listed when the decline fails", async () => {
    db.declined = { data: null, error: { code: "XX000" } };
    await mount();
    await click("Decline");

    expect(toast.error).toHaveBeenCalledWith("Couldn't decline the request. Try again.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
