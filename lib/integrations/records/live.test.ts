import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordsError } from "./errors";
import { liveDirectory, type LiveSources, planLiveRequest, type VisibleHousehold, type VisiblePerson } from "./livePlan";
import type { RecordsLiveDetails } from "./types";

const ORG = "00000000-0000-0000-0000-0000000000aa";
const VIEWER = "00000000-0000-0000-0000-00000000a001";
const SPOUSE = "00000000-0000-0000-0000-000000000002";
const OWN_VALUE = "00000000-0000-0000-0000-000000000003";
const CHANGED = "00000000-0000-0000-0000-000000000004";
const UNLINKED = "00000000-0000-0000-0000-000000000005";
const HOME = "00000000-0000-0000-0000-0000000000f1";
const OTHER_HOME = "00000000-0000-0000-0000-0000000000f2";
const CHILD = "00000000-0000-0000-0000-0000000000c1";

const person = (id: string, over: Partial<VisiblePerson> = {}): VisiblePerson => ({
  id,
  family_id: null,
  relationship: "primary",
  birth_month: null,
  birth_day: null,
  ...over,
});

const household = (id: string, over: Partial<VisibleHousehold> = {}): VisibleHousehold => ({
  id,
  address_line1: null,
  city: null,
  anniversary_month: null,
  anniversary_day: null,
  family_members_list: [],
  ...over,
});

const VISIBLE_PEOPLE = [
  person(VIEWER, { family_id: HOME }),
  person(SPOUSE, { family_id: HOME, relationship: "spouse" }),
  person(OWN_VALUE, { birth_month: 2, birth_day: 3 }),
  person(CHANGED),
  person(UNLINKED),
];
const VISIBLE_HOUSEHOLDS = [
  household(HOME, {
    family_members_list: [{ id: CHILD, claimed_profile_id: null, birth_month: null, birth_day: null, graduation_year: null }],
  }),
  household(OTHER_HOME, { address_line1: "1 Own St" }),
];

// Links and sources include people and households the viewer can't see,
// standing in for a service read that wrongly returned more than asked.
const SOURCES: LiveSources = {
  fields: new Set(["birthday", "anniversary", "address"]),
  personLinks: new Map([
    [VIEWER, "100"],
    [SPOUSE, "101"],
    [OWN_VALUE, "102"],
    [CHANGED, "103"],
    ["00000000-0000-0000-0000-0000000000ff", "999"],
  ]),
  householdLinks: new Map([
    [HOME, "500"],
    [OTHER_HOME, "501"],
    ["00000000-0000-0000-0000-0000000000fe", "599"],
  ]),
  personStates: new Map([[`${CHANGED}:birthday`, "changed"]]),
  addressStates: new Map(),
  children: new Map([[CHILD, "900"]]),
};

const VIEWER_ROW = { id: VIEWER, family_id: HOME, relationship: "primary" };

const plan = (over: Partial<LiveSources> = {}) =>
  planLiveRequest({ viewer: VIEWER_ROW, people: VISIBLE_PEOPLE, households: VISIBLE_HOUSEHOLDS, sources: { ...SOURCES, ...over } });

describe("planLiveRequest", () => {
  it("asks the records only about visible, linked people and households whose detail isn't two42's own", () => {
    const planned = plan();
    // Not 102 (own birthday), 103 (changed), 999 (not visible), and nothing for the unlinked person.
    expect(planned.people).toEqual(["100", "101", "900"]);
    // Not 501 (own address) or 599 (not visible).
    expect(planned.families).toEqual(["500"]);
  });

  it("reads the household's anniversary from its primary, and asks nothing for a field not from the records", () => {
    const anniversary = plan().planned.find((p) => p.field === "anniversary");
    expect(anniversary).toEqual({ kind: "household", id: HOME, field: "anniversary", from: "100" });
    expect(plan({ fields: new Set() }).planned.filter((p) => p.kind !== "child")).toEqual([]);
  });

  it("keeps a detail the member hid, offering the viewer only their own and their household's back", () => {
    const planned = plan({
      personStates: new Map([
        [`${VIEWER}:birthday`, "cleared"],
        [`${CHANGED}:birthday`, "cleared"],
        [`${VIEWER}:anniversary`, "cleared"],
      ]),
      addressStates: new Map([[HOME, "cleared"]]),
    });
    expect(planned.people).toEqual(["101", "900"]);
    expect(planned.families).toEqual([]);
    expect(planned.hidden).toEqual([
      { kind: "person", id: VIEWER, field: "birthday" },
      { kind: "household", id: HOME, field: "anniversary" },
      { kind: "household", id: HOME, field: "address" },
    ]);
    expect(planned.canHide).toEqual({ person: VIEWER, household: HOME });
  });

  it("lets only a household's primary or spouse hide its details", () => {
    const child = planLiveRequest({
      viewer: { id: VIEWER, family_id: HOME, relationship: "child" },
      people: VISIBLE_PEOPLE,
      households: VISIBLE_HOUSEHOLDS,
      sources: SOURCES,
    });
    expect(child.canHide).toEqual({ person: VIEWER, household: null });
  });

  it("asks for a child's details only for a child added from the records' suggestions", () => {
    expect(plan({ children: new Map() }).people).toEqual(["100", "101"]);
  });
});

describe("liveDirectory", () => {
  const details: RecordsLiveDetails = {
    people: new Map([
      ["100", { birthday: { month: 4, day: 12 }, anniversary: { month: 6, day: 9, year: 2001 }, graduationYear: null }],
      ["101", { birthday: { month: 2, day: 30 }, anniversary: { month: null, day: null, year: null }, graduationYear: null }],
      ["900", { birthday: { month: 9, day: 1 }, anniversary: { month: null, day: null, year: null }, graduationYear: 2034 }],
    ]),
    families: new Map([
      ["500", { street1: "12 oak st", street2: "", city: "austin", state: "tx", postalCode: "78701", country: "US" }],
    ]),
  };

  it("normalizes values as the copy stores them, never with a birth year, and an impossible date counts as none", () => {
    const live = liveDirectory(plan(), details, new Date("2026-11-26"));
    expect(live.people[VIEWER]).toEqual({ birthday: { state: "shown", value: { month: 4, day: 12 } } });
    expect(live.people[SPOUSE]).toEqual({ birthday: { state: "empty" } });
    expect(live.households[HOME]).toEqual({
      anniversary: { state: "shown", value: { month: 6, day: 9, year: 2001 } },
      address: {
        state: "shown",
        value: { address_line1: "12 Oak St", address_line2: null, city: "Austin", state: "TX", postal_code: "78701" },
      },
    });
    expect(live.children[CHILD]).toEqual({
      birthday: { state: "shown", value: { month: 9, day: 1 } },
      grade: { state: "shown", value: 2034 },
    });
  });

  it("marks every planned detail unavailable when the records couldn't be reached", () => {
    const live = liveDirectory(plan(), null, new Date("2026-11-26"));
    expect(live.people[VIEWER].birthday).toEqual({ state: "unavailable" });
    expect(live.households[HOME]).toEqual({ anniversary: { state: "unavailable" }, address: { state: "unavailable" } });
    expect(live.children[CHILD]).toEqual({ birthday: { state: "unavailable" }, grade: { state: "unavailable" } });
  });
});

const store = vi.hoisted(() => ({
  readMode: vi.fn(),
  loadCredentials: vi.fn(),
  readLiveSources: vi.fn(),
}));
const details = vi.hoisted(() => vi.fn());
const tables = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("./store", () => store);
vi.mock("./crypto", () => ({ loadRecordsSecret: () => Buffer.alloc(32) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: ORG, error: null }),
    from: (table: string) => {
      const result = { data: tables.data[table], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => void) => resolve(result),
      };
      return chain;
    },
  }),
}));

const { readLiveDirectory } = await import("./live");

describe("readLiveDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tables.data = { profiles_directory: VISIBLE_PEOPLE, families_directory_full: VISIBLE_HOUSEHOLDS, profiles: VIEWER_ROW };
    store.readMode.mockResolvedValue({ mode: "live", suggestChildren: true });
    store.loadCredentials.mockResolvedValue({
      provider: { id: "rock", live: { details } },
      creds: { baseUrl: "https://rock.example.org", key: "k" },
      connectionId: "c",
    });
    store.readLiveSources.mockResolvedValue(SOURCES);
    details.mockResolvedValue({ people: new Map(), families: new Map() });
  });

  it("for a church that never connected, is off and never asks the records", async () => {
    store.loadCredentials.mockResolvedValue(null);
    expect(await readLiveDirectory(VIEWER)).toEqual({ mode: "off" });
    expect(details).not.toHaveBeenCalled();
    expect(store.readLiveSources).not.toHaveBeenCalled();
  });

  it("in copy mode, is off and never asks the records", async () => {
    store.readMode.mockResolvedValue({ mode: "copy", suggestChildren: false });
    expect(await readLiveDirectory(VIEWER)).toEqual({ mode: "off" });
    expect(details).not.toHaveBeenCalled();
  });

  it("is off for a provider that can't show details live", async () => {
    store.loadCredentials.mockResolvedValue({ provider: { id: "rock" }, creds: {}, connectionId: "c" });
    expect(await readLiveDirectory(VIEWER)).toEqual({ mode: "off" });
  });

  it("reads sources only for the people the viewer's own directory read returned, and asks the records once, for them alone", async () => {
    await readLiveDirectory(VIEWER);
    expect(store.readLiveSources).toHaveBeenCalledWith(
      ORG,
      {
        profiles: VISIBLE_PEOPLE.map((p) => p.id),
        households: [HOME, OTHER_HOME],
        members: [CHILD],
      },
      true,
    );
    expect(details).toHaveBeenCalledTimes(1);
    expect(details.mock.calls[0][1]).toEqual({ people: ["100", "101", "900"], families: ["500"] });
  });

  it("with the records unreachable, answers unavailable details and logs no value or error text", async () => {
    details.mockRejectedValue(new RecordsError("unreachable"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const live = await readLiveDirectory(VIEWER);
    expect(live.mode === "live" && live.people[VIEWER].birthday).toEqual({ state: "unavailable" });
    const written = spy.mock.calls.map(([line]) => String(line)).join("\n");
    spy.mockRestore();
    expect(written).toContain('"step":"unreachable"');
    for (const value of ['"100"', '"500"', "rock.example.org", "Oak"]) expect(written).not.toContain(value);
  });
});
