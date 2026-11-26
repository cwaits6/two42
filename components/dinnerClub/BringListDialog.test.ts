// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));
vi.mock("@/components/ui/dialog", () => {
  const passthrough = (tag: string) =>
    function Part({ children }: { children?: ReactNode }) {
      return createElement(tag, null, children);
    };
  return {
    Dialog: passthrough("div"),
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("h2"),
    DialogDescription: passthrough("p"),
  };
});

const calls = vi.hoisted(() => [] as string[]);
const deleted = vi.hoisted(() => ({ rows: [] as { party_id: string }[] }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (relation: string) => ({
      upsert: () => ({
        select: async () => {
          calls.push(`upsert ${relation}`);
          return { data: [], error: null };
        },
      }),
      delete: () => ({
        eq: (_column: string, dinnerId: string) => ({
          in: (_inColumn: string, partyIds: string[]) => ({
            select: async () => {
              calls.push(`delete ${relation} ${dinnerId} ${partyIds.join(",")}`);
              return { data: deleted.rows, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

const { BringListDialog } = await import("./BringListDialog");

let root: Root | null = null;

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(BringListDialog, {
        dinner: { id: "d1", seasonId: "s", groupId: "g", tableId: "T", label: "First" },
        guests: [
          { partyId: "a", names: "Ada", item: "Dessert" },
          { partyId: "b", names: "Ben", item: "Bread" },
        ],
        earlier: {},
        dinnerIndex: 0,
      }),
    ),
  );
}

async function click(label: string, nth = 0) {
  const buttons = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === label);
  await act(async () => buttons[nth].click());
}

async function clearAdaAndSave() {
  await mount();
  await click("What guests bring");
  // The first guest's "Nothing" option.
  await click("Nothing", 0);
  await click("Save list");
}

beforeEach(() => {
  calls.length = 0;
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("BringListDialog save", () => {
  it("clears one guest's item with one delete and no upsert", async () => {
    deleted.rows = [{ party_id: "a" }];
    await clearAdaAndSave();
    expect(calls).toEqual(["delete dinner_contributions d1 a"]);
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reports a failure when the delete matched no row", async () => {
    deleted.rows = [];
    await clearAdaAndSave();
    expect(calls).toEqual(["delete dinner_contributions d1 a"]);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
