// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "@/lib/dinnerClub/shuffle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/ui/select", () => import("@/components/ui/select.mock"));

const calls = vi.hoisted(() => [] as string[]);
const saved = vi.hoisted(() => ({ body: null as unknown, ok: true }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (relation: string) => ({
      upsert: (row: { season_id: string; body: unknown }, options: { onConflict: string }) => ({
        select: async () => {
          calls.push(`save ${relation} ${row.season_id} ${options.onConflict}`);
          saved.body = row.body;
          return saved.ok ? { data: [{ season_id: "s" }], error: null } : { data: null, error: { message: "down" } };
        },
      }),
    }),
  }),
}));

const { TablesEditor } = await import("./TablesEditor");

// A one-host table fitted on the page to a date added after publishing: the
// stored draft does not have the new date's host, the one on screen does.
const fitted: Draft = {
  version: 1,
  seed: 0,
  tables: [
    {
      key: "T1",
      tableId: "T1",
      seasonDateId: null,
      partyIds: ["h1", "c1"],
      hosts: [
        { seasonDateId: "d1", partyId: "h1" },
        { seasonDateId: "d2", partyId: "h1" },
      ],
    },
  ],
};

let root: Root | null = null;

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(TablesEditor, {
        groupId: "g",
        seasonId: "s",
        format: "same_table_one_host",
        published: true,
        dates: [
          { value: "d1", label: "First" },
          { value: "d2", label: "Second" },
        ],
        tableSize: { min: 2, max: 8 },
        allowBackToBack: false,
        parties: [
          { id: "h1", size: 2, canHost: true, seats: 8, preferredDateId: null, unavailableDateIds: [] },
          { id: "c1", size: 2, canHost: false, seats: null, preferredDateId: null, unavailableDateIds: [] },
        ],
        names: { h1: "Hosts", c1: "Guests" },
        initialDraft: fitted,
      }),
    ),
  );
}

async function click(label: string) {
  const buttons = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === label);
  await act(async () => buttons[buttons.length - 1].click());
}

beforeEach(() => {
  calls.length = 0;
  saved.ok = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      return Response.json({ changed: 0, sent: 0, capped: false, unsent: false });
    }),
  );
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("TablesEditor publish", () => {
  it("saves the draft on screen before publishing, since publish reads the stored one", async () => {
    await mount();
    await click("Publish changes");
    await click("Publish changes");
    expect(calls).toEqual(["save dinner_drafts s season_id", "POST /api/dinner-club/seasons/s/publish"]);
    expect(saved.body).toEqual(fitted);
  });

  it("does not publish when the draft could not be saved", async () => {
    saved.ok = false;
    await mount();
    await click("Publish changes");
    await click("Publish changes");
    expect(calls).toEqual(["save dinner_drafts s season_id"]);
    expect(toast.error).toHaveBeenCalled();
  });
});
