// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supperKey, type Draft } from "@/lib/supperClub/shuffle";

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
      upsert: (row: { rotation_id: string; body: unknown }, options: { onConflict: string }) => ({
        select: async () => {
          calls.push(`save ${relation} ${row.rotation_id} ${options.onConflict}`);
          saved.body = row.body;
          return saved.ok ? { data: [{ rotation_id: "s" }], error: null } : { data: null, error: { message: "down" } };
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
      rotationDateId: null,
      partyIds: ["h1", "c1"],
      hosts: [
        { rotationDateId: "d1", partyId: "h1" },
        { rotationDateId: "d2", partyId: "h1" },
      ],
    },
  ],
};

let root: Root | null = null;

async function mount(over: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(TablesEditor, {
        groupId: "g",
        rotationId: "s",
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
        heldSuppers: [],
        futureDateIds: ["d1", "d2"],
        cantHost: {},
        pastPairs: [],
        ...over,
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
    expect(calls).toEqual(["save supper_drafts s rotation_id", "POST /api/supper-club/rotations/s/publish"]);
    expect(saved.body).toEqual(fitted);
  });

  it("does not publish when the draft could not be saved", async () => {
    saved.ok = false;
    await mount();
    await click("Publish changes");
    await click("Publish changes");
    expect(calls).toEqual(["save supper_drafts s rotation_id"]);
    expect(toast.error).toHaveBeenCalled();
  });
});

// The regular host h1 can't host the first supper and s1 stands in for it,
// so each hosts one of the table's two suppers.
const standIn: Draft = {
  version: 1,
  seed: 0,
  tables: [
    {
      key: "T1",
      tableId: "T1",
      rotationDateId: null,
      partyIds: ["h1", "s1", "c1"],
      hosts: [
        { rotationDateId: "d1", partyId: "s1" },
        { rotationDateId: "d2", partyId: "h1" },
      ],
    },
  ],
};

describe("TablesEditor can't host", () => {
  async function mountStandIn(published = false) {
    await mount({
      parties: [
        { id: "h1", size: 2, canHost: true, seats: 8, preferredDateId: null, unavailableDateIds: [] },
        { id: "s1", size: 2, canHost: true, seats: 8, preferredDateId: null, unavailableDateIds: [] },
        { id: "c1", size: 2, canHost: false, seats: null, preferredDateId: null, unavailableDateIds: [] },
      ],
      names: { h1: "Hosts", s1: "Stand-ins", c1: "Guests" },
      initialDraft: standIn,
      // Publishing the stand-in clears the supper's can't-host flag.
      cantHost: published ? {} : { [supperKey("T1", "d1")]: "h1" },
    });
  }

  function optionsOf(id: string) {
    const field = document.querySelector(`label[for="${id}"]`)?.parentElement;
    return Array.from(field?.querySelectorAll("button") ?? []);
  }

  function pressed(id: string) {
    return optionsOf(id)
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.textContent);
  }

  async function pick(id: string, label: string) {
    const option = optionsOf(id).find((b) => b.textContent === label);
    await act(async () => option!.click());
  }

  const savedHosts = () => (saved.body as Draft).tables[0].hosts;

  it("names the published host as the one who can't host, and the stand-in as hosting instead", async () => {
    await mountStandIn();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Hosts can't host on First.");
    expect(text).toContain("Stand-ins hosts instead. Publish to tell the table.");
    expect(text).not.toContain("Stand-ins can't host");
  });

  it("leaves the host who can't host out of the stand-in choices", async () => {
    await mountStandIn();
    const choices = optionsOf("standin-T1-d1").map((b) => b.textContent);
    expect(choices).toEqual(["Stand-ins"]);
  });

  it("keeps the regular host as the table's host while a stand-in waits to be published", async () => {
    await mountStandIn();
    expect(pressed("host-T1")).toEqual(["Hosts"]);
  });

  it("keeps the stand-in when the table's host is picked again before publishing", async () => {
    await mountStandIn();
    await pick("host-T1", "Hosts");
    expect(savedHosts()).toEqual(standIn.tables[0].hosts);
  });

  it("shows each supper's host once a published stand-in hosts one of them", async () => {
    await mountStandIn(true);
    expect(document.querySelector('label[for="host-T1"]')).toBeNull();
    expect(pressed("host-T1-d1")).toEqual(["Stand-ins"]);
    expect(pressed("host-T1-d2")).toEqual(["Hosts"]);
  });

  it("changes only the picked supper's host once a published stand-in hosts one of them", async () => {
    await mountStandIn(true);
    await pick("host-T1-d2", "Stand-ins");
    expect(savedHosts()).toEqual([
      { rotationDateId: "d1", partyId: "s1" },
      { rotationDateId: "d2", partyId: "s1" },
    ]);
  });
});
