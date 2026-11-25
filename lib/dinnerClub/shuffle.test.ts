import { describe, expect, it } from "vitest";
import {
  blocksPublish,
  dinnerKey,
  draftFromPublished,
  draftWarnings,
  fitDraft,
  hostsNeeded,
  moveParty,
  pairKey,
  parseDraft,
  partyPeople,
  setTableHost,
  shuffle,
  swapParties,
  tooFewHosts,
  type Draft,
  type ShuffleInput,
  type ShuffleParty,
} from "./shuffle";

function party(id: string, size: 1 | 2, host?: { seats: number; preferredDateId?: string; unavailable?: string[] }): ShuffleParty {
  return {
    id,
    size,
    canHost: Boolean(host),
    seats: host?.seats ?? null,
    preferredDateId: host?.preferredDateId ?? null,
    unavailableDateIds: host?.unavailable ?? [],
  };
}

const DATES = ["d1", "d2", "d3", "d4", "d5"];

function input(parties: ShuffleParty[], over: Partial<ShuffleInput> = {}): ShuffleInput {
  return {
    format: "same_table_one_host",
    parties,
    dateIds: DATES,
    tableSize: { min: 6, max: 8 },
    allowBackToBack: false,
    pastPairs: [],
    seed: 42,
    ...over,
  };
}

/** 7 couples, 3 of them hosting with room for 8, and 3 singles. */
function sevenCouplesThreeSingles(): ShuffleParty[] {
  return [
    party("h1", 2, { seats: 8 }),
    party("h2", 2, { seats: 8 }),
    party("h3", 2, { seats: 8 }),
    party("c4", 2),
    party("c5", 2),
    party("c6", 2),
    party("c7", 2),
    party("s1", 1),
    party("s2", 1),
    party("s3", 1),
  ];
}

function byId(parties: ShuffleParty[]) {
  return new Map(parties.map((p) => [p.id, p]));
}

function seatedOnce(draft: Draft, parties: ShuffleParty[]) {
  const seen = draft.tables.flatMap((t) => t.partyIds);
  expect([...seen].sort()).toEqual(parties.map((p) => p.id).sort());
}

describe("shuffle, same table with one host", () => {
  it("seats 7 couples and 3 singles with 3 hosts at three tables of 5 to 6, no couple split, none over seats", () => {
    const parties = sevenCouplesThreeSingles();
    for (const seed of [1, 2, 3, 42, 1000]) {
      const draft = shuffle(input(parties, { seed }));
      expect(draft.tables).toHaveLength(3);
      seatedOnce(draft, parties);
      const sizes = draft.tables.map((t) => partyPeople(t, byId(parties))).sort();
      expect(sizes).toEqual([5, 6, 6]);
      const warnings = draftWarnings(draft, input(parties));
      expect(Object.values(warnings.tables).every((w) => !w.overSeats && !w.noHost)).toBe(true);
    }
  });

  it("gives each table one host for every dinner, within that host's seats", () => {
    const parties = sevenCouplesThreeSingles();
    const draft = shuffle(input(parties));
    for (const t of draft.tables) {
      const host = t.hosts[0].partyId;
      expect(host).toMatch(/^h/);
      expect(t.partyIds).toContain(host);
      expect(t.hosts.map((h) => h.seasonDateId)).toEqual(DATES);
      expect(t.hosts.every((h) => h.partyId === host)).toBe(true);
      expect(partyPeople(t, byId(parties))).toBeLessThanOrEqual(8);
    }
  });

  it("keeps a table within a smaller host's seats", () => {
    const parties = [party("h1", 2, { seats: 4 }), party("h2", 2, { seats: 10 }), ...["a", "b", "c", "d"].map((id) => party(id, 2))];
    const draft = shuffle(input(parties, { tableSize: { min: 6, max: 8 } }));
    const small = draft.tables.find((t) => t.hosts[0].partyId === "h1")!;
    expect(partyPeople(small, byId(parties))).toBeLessThanOrEqual(4);
  });

  it("seats hosts beyond the tables needed as guests", () => {
    const parties = [
      party("h1", 2, { seats: 8 }),
      party("h2", 2, { seats: 8 }),
      party("h3", 2, { seats: 6 }),
      party("c1", 2),
      party("c2", 2),
      party("s1", 1),
    ];
    const draft = shuffle(input(parties));
    expect(draft.tables).toHaveLength(2);
    seatedOnce(draft, parties);
    const hosts = draft.tables.map((t) => t.hosts[0].partyId);
    expect(hosts).not.toContain("h3");
  });

  it("gives a different draft when shuffled again", () => {
    const parties = sevenCouplesThreeSingles();
    const a = shuffle(input(parties, { seed: 1 }));
    const b = shuffle(input(parties, { seed: 2 }));
    expect(a.tables.map((t) => t.partyIds)).not.toEqual(b.tables.map((t) => t.partyIds));
    expect(shuffle(input(parties, { seed: 1 }))).toEqual(a);
  });

  it("does not leave a single as the only one-person party at a table when it can be avoided", () => {
    const parties = [
      party("h1", 2, { seats: 8 }),
      party("h2", 2, { seats: 8 }),
      party("c1", 2),
      party("c2", 2),
      party("s1", 1),
      party("s2", 1),
    ];
    for (const seed of [1, 2, 3, 4, 5]) {
      const draft = shuffle(input(parties, { seed }));
      for (const t of draft.tables) {
        const singles = t.partyIds.filter((id) => id.startsWith("s")).length;
        expect(singles).not.toBe(1);
      }
    }
  });

  it("keeps parties who shared a table before apart where it can", () => {
    const parties = [
      party("h1", 2, { seats: 8 }),
      party("h2", 2, { seats: 8 }),
      party("c1", 2),
      party("c2", 2),
    ];
    const draft = shuffle(input(parties, { tableSize: { min: 4, max: 4 }, pastPairs: [["c1", "c2"], ["h1", "c1"]] }));
    const t1 = draft.tables.find((t) => t.partyIds.includes("c1"))!;
    expect(t1.partyIds).not.toContain("c2");
    expect(t1.partyIds).not.toContain("h1");
  });
});

describe("shuffle, same table with hosts taking turns", () => {
  const parties = [
    party("h1", 2, { seats: 8, preferredDateId: "d3" }),
    party("h2", 2, { seats: 8 }),
    party("h3", 1, { seats: 7 }),
    party("h4", 2, { seats: 8 }),
    party("h5", 2, { seats: 8 }),
    party("c1", 2),
    party("c2", 2),
    party("s1", 1),
    party("s2", 1),
  ];

  it("covers every dinner, and nobody hosts twice before everyone at the table has hosted", () => {
    for (const seed of [1, 7, 42]) {
      const draft = shuffle(input(parties, { format: "same_table_rotating", seed }));
      expect(draft.tables).toHaveLength(2);
      seatedOnce(draft, parties);
      for (const t of draft.tables) {
        const hostIds = t.partyIds.filter((id) => id.startsWith("h"));
        expect(hostIds.length).toBeGreaterThanOrEqual(1);
        expect(t.hosts.map((h) => h.seasonDateId)).toEqual(DATES);
        const turns = new Map(hostIds.map((id) => [id, 0]));
        for (const h of t.hosts) {
          expect(h.partyId).not.toBeNull();
          expect(hostIds).toContain(h.partyId);
          turns.set(h.partyId!, turns.get(h.partyId!)! + 1);
          const counts = [...turns.values()];
          expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps each table within its smallest host's seats", () => {
    const draft = shuffle(input(parties, { format: "same_table_rotating" }));
    const warnings = draftWarnings(draft, input(parties, { format: "same_table_rotating" }));
    expect(Object.values(warnings.tables).some((w) => w.overSeats)).toBe(false);
  });

  it("adds tables when a small host would take a turn at a table too big for them", () => {
    const hosts = [party("h1", 2, { seats: 6 }), party("h2", 2, { seats: 2 }), party("h3", 2, { seats: 2 })];
    for (const seed of [1, 7, 42]) {
      const over = { format: "same_table_rotating" as const, dateIds: ["d1", "d2", "d3"], seed };
      const draft = shuffle(input(hosts, over));
      seatedOnce(draft, hosts);
      expect(Object.values(draftWarnings(draft, input(hosts, over)).tables).some((w) => w.overSeats)).toBe(false);
    }
  });

  it("gives a host the turn they asked for when it is theirs to take", () => {
    const two = [party("h1", 2, { seats: 8, preferredDateId: "d2" }), party("h2", 2, { seats: 8, preferredDateId: "d1" }), party("c1", 2)];
    const draft = shuffle(input(two, { format: "same_table_rotating", dateIds: ["d1", "d2"] }));
    expect(draft.tables).toHaveLength(1);
    expect(draft.tables[0].hosts).toEqual([
      { seasonDateId: "d1", partyId: "h2" },
      { seasonDateId: "d2", partyId: "h1" },
    ]);
  });
});

describe("shuffle, new tables each dinner", () => {
  const parties = [
    party("h1", 2, { seats: 8 }),
    party("h2", 2, { seats: 8, unavailable: ["d2"] }),
    party("h3", 2, { seats: 8 }),
    party("h4", 2, { seats: 8 }),
    party("c1", 2),
    party("c2", 2),
    party("c3", 2),
    party("s1", 1),
    party("s2", 1),
  ];
  const base = (over: Partial<ShuffleInput> = {}) => input(parties, { format: "new_tables", ...over });

  it("seats everyone once at each dinner, with that dinner's hosts", () => {
    const draft = shuffle(base());
    for (const d of DATES) {
      const tables = draft.tables.filter((t) => t.seasonDateId === d);
      expect(tables).toHaveLength(2);
      expect(tables.flatMap((t) => t.partyIds).sort()).toEqual(parties.map((p) => p.id).sort());
      for (const t of tables) {
        expect(t.hosts).toHaveLength(1);
        expect(t.hosts[0].seasonDateId).toBe(d);
        expect(t.partyIds).toContain(t.hosts[0].partyId);
      }
    }
  });

  it("respects dates a host can't host and has nobody host two in a row", () => {
    const draft = shuffle(base());
    const hostsOn = (d: string) => draft.tables.filter((t) => t.seasonDateId === d).map((t) => t.hosts[0].partyId);
    expect(hostsOn("d2")).not.toContain("h2");
    for (let i = 1; i < DATES.length; i++) {
      const before = new Set(hostsOn(DATES[i - 1]));
      expect(hostsOn(DATES[i]).some((h) => before.has(h))).toBe(false);
    }
    const warnings = draftWarnings(draft, base());
    expect(Object.values(warnings.tables).every((w) => w.backToBack.length === 0)).toBe(true);
  });

  it("spreads hosting across the season", () => {
    const draft = shuffle(base({ dateIds: ["d1", "d2", "d3", "d4"] }));
    const counts = new Map<string, number>();
    draft.tables.forEach((t) => counts.set(t.hosts[0].partyId!, (counts.get(t.hosts[0].partyId!) ?? 0) + 1));
    expect([...counts.values()]).toEqual([2, 2, 2, 2]);
  });

  it("lets a host host two in a row when the leader allows it", () => {
    const few = [party("h1", 2, { seats: 8 }), party("c1", 2), party("c2", 2)];
    const draft = shuffle(input(few, { format: "new_tables", allowBackToBack: true, dateIds: ["d1", "d2"] }));
    expect(draft.tables.map((t) => t.hosts[0].partyId)).toEqual(["h1", "h1"]);
    expect(Object.values(draftWarnings(draft, input(few, { format: "new_tables", allowBackToBack: true, dateIds: ["d1", "d2"] })).tables)
      .every((w) => w.backToBack.length === 0)).toBe(true);
  });

  it("warns when too few hosts forces someone to host two in a row", () => {
    const few = [party("h1", 2, { seats: 8 }), party("c1", 2), party("c2", 2)];
    const two = input(few, { format: "new_tables", dateIds: ["d1", "d2"] });
    const draft = shuffle(two);
    expect(draftWarnings(draft, two).tables[draft.tables[1].key].backToBack).toEqual(["h1"]);
  });

  it("keeps people apart who already ate together this season where it can", () => {
    const draft = shuffle(base());
    const pairs = new Map<string, number>();
    draft.tables.forEach((t) => {
      for (let a = 0; a < t.partyIds.length; a++) {
        for (let b = a + 1; b < t.partyIds.length; b++) {
          const k = pairKey(t.partyIds[a], t.partyIds[b]);
          pairs.set(k, (pairs.get(k) ?? 0) + 1);
        }
      }
    });
    // Two tables of about half the parties over five dinners: some pairs
    // must meet again, but none every time. The two singles are the
    // exception: keeping a single from being the only one at a table comes
    // first.
    pairs.delete(pairKey("s1", "s2"));
    expect(Math.max(...pairs.values())).toBeLessThan(DATES.length);
  });
});

describe("draft warnings and manual changes", () => {
  const parties = sevenCouplesThreeSingles();
  const settings = input(parties);
  const draft = shuffle(settings);
  const [a, b] = draft.tables;

  it("warns that a table is over seats after a move, and clears it when moved back", () => {
    const guest = b.partyIds.find((id) => id !== b.hosts[0].partyId && id.startsWith("c"))!;
    const moved = moveParty(moveParty(draft, b.key, guest, a.key), b.key, b.partyIds.find((id) => id !== guest && id !== b.hosts[0].partyId)!, a.key);
    expect(draftWarnings(moved, settings).tables[a.key].overSeats).toBe(partyPeople(moved.tables[0], byId(parties)) > 8);
    const once = moveParty(draft, b.key, guest, a.key);
    const back = moveParty(once, a.key, guest, b.key);
    expect(draftWarnings(back, settings).tables[a.key].overSeats).toBe(false);
  });

  it("warns of a table with no host when its host moves away, until a new host is set", () => {
    const host = a.hosts[0].partyId!;
    const moved = moveParty(draft, a.key, host, b.key);
    expect(draftWarnings(moved, settings).tables[a.key].noHost).toBe(true);
    const guestHost = moved.tables[0].partyIds[0];
    const fixed = setTableHost(moved, a.key, guestHost);
    expect(fixed.tables[0].hosts.every((h) => h.partyId === guestHost)).toBe(true);
    expect(draftWarnings(fixed, settings).tables[a.key].noHost).toBe(false);
  });

  it("asks for no host at a dinner already held, which keeps the host it had", () => {
    const rotating = input(parties, { format: "same_table_rotating" });
    const published: Draft = {
      ...draft,
      tables: draft.tables.map((t, i) => ({
        ...t,
        tableId: `table-${i}`,
        hosts: t.hosts.map((h) => (h.seasonDateId === "d1" ? { ...h, partyId: null } : h)),
      })),
    };
    expect(blocksPublish(draftWarnings(published, rotating))).toBe(true);
    const held = new Set(published.tables.map((t) => dinnerKey(t.tableId!, "d1")));
    expect(blocksPublish(draftWarnings(published, rotating, held))).toBe(false);
  });

  it("drops a table its last party moves away from", () => {
    const one: Draft = {
      version: 1,
      seed: 1,
      tables: [
        { key: "x", tableId: null, seasonDateId: null, partyIds: ["s1"], hosts: [{ seasonDateId: "d1", partyId: null }] },
        { key: "y", tableId: null, seasonDateId: null, partyIds: ["h1"], hosts: [{ seasonDateId: "d1", partyId: "h1" }] },
      ],
    };
    const moved = moveParty(one, "x", "s1", "y");
    expect(moved.tables.map((t) => t.key)).toEqual(["y"]);
    expect(moved.tables[0].partyIds).toEqual(["h1", "s1"]);
  });

  it("swaps two parties, hosting included", () => {
    const hostA = a.hosts[0].partyId!;
    const guestB = b.partyIds.find((id) => id !== b.hosts[0].partyId)!;
    const swapped = swapParties(draft, a.key, hostA, b.key, guestB);
    expect(swapped.tables[0].partyIds).toContain(guestB);
    expect(swapped.tables[1].partyIds).toContain(hostA);
    expect(swapped.tables[0].hosts.every((h) => h.partyId === guestB)).toBe(true);
  });

  it("warns of a repeat pairing", () => {
    const [p, q] = a.partyIds;
    const warned = draftWarnings(draft, { ...settings, pastPairs: [[p, q]] });
    expect(warned.tables[a.key].repeatPairs).toEqual([[p, q]]);
  });

  it("warns of too few hosts", () => {
    expect(tooFewHosts("same_table_one_host", parties, DATES, 8)).toBe(false);
    expect(tooFewHosts("same_table_one_host", parties, DATES, 5)).toBe(true);
    expect(hostsNeeded(17, 8)).toBe(3);
    const newTables = [party("h1", 2, { seats: 8, unavailable: ["d2"] }), party("h2", 2, { seats: 8 }), party("c1", 2), party("c2", 2), party("c3", 2)];
    expect(tooFewHosts("new_tables", newTables, ["d1"], 8)).toBe(false);
    expect(tooFewHosts("new_tables", newTables, ["d1", "d2"], 8)).toBe(true);
  });

  it("rebuilds a draft from published tables, leaving a date added since with no host", () => {
    const rebuilt = draftFromPublished(
      [
        { id: "T2", seasonDateId: null, position: 2, partyIds: ["h2", "c4"], hosts: [{ seasonDateId: "d1", partyId: "h2" }] },
        { id: "T1", seasonDateId: null, position: 1, partyIds: ["h1", "c5"], hosts: [{ seasonDateId: "d1", partyId: "h1" }] },
      ],
      "same_table_one_host",
      ["d1", "d2"],
      9
    );
    expect(rebuilt.tables.map((t) => t.tableId)).toEqual(["T1", "T2"]);
    expect(rebuilt.tables[0].hosts).toEqual([
      { seasonDateId: "d1", partyId: "h1" },
      { seasonDateId: "d2", partyId: null },
    ]);
    const warnings = draftWarnings(rebuilt, input(parties, { dateIds: ["d1", "d2"] }));
    expect(warnings.tables.T1.noHost).toBe(true);
  });
});

describe("a saved draft after the season changed", () => {
  const table = (key: string, partyIds: string[], hosts: [string, string | null][], seasonDateId: string | null = null) => ({
    key,
    tableId: null,
    seasonDateId,
    partyIds,
    hosts: hosts.map(([d, partyId]) => ({ seasonDateId: d, partyId })),
  });
  const saved = (tables: Draft["tables"]): Draft => ({ version: 1, seed: 3, tables });

  it("gives a date added since the save the table's one host, and drops a deleted date", () => {
    const fitted = fitDraft(
      saved([table("a", ["h1", "c4"], [["d1", "h1"], ["d2", "h1"]])]),
      "same_table_one_host",
      ["d2", "d3"],
      ["h1", "c4"]
    )!;
    expect(fitted.tables[0].hosts).toEqual([
      { seasonDateId: "d2", partyId: "h1" },
      { seasonDateId: "d3", partyId: "h1" },
    ]);
  });

  it("leaves a new date unhosted when hosts take turns, and warns until one is picked", () => {
    const parties = [party("h1", 2, { seats: 8 }), party("h2", 2, { seats: 8 })];
    const fitted = fitDraft(
      saved([table("a", ["h1", "h2"], [["d1", "h1"], ["d2", "h2"]])]),
      "same_table_rotating",
      ["d1", "d2", "d3"],
      ["h1", "h2"]
    )!;
    expect(fitted.tables[0].hosts.map((h) => h.partyId)).toEqual(["h1", "h2", null]);
    const warnings = draftWarnings(fitted, input(parties, { format: "same_table_rotating", dateIds: ["d1", "d2", "d3"] }));
    expect(blocksPublish(warnings)).toBe(true);
  });

  it("takes a party no longer signed up off its table, and its hosting with it", () => {
    const fitted = fitDraft(
      saved([table("a", ["h1", "c4"], [["d1", "h1"]]), table("b", ["gone"], [["d1", "gone"]])]),
      "same_table_one_host",
      ["d1"],
      ["c4"]
    )!;
    expect(fitted.tables).toEqual([table("a", ["c4"], [["d1", null]])]);
  });

  it("drops a deleted date's tables and warns of a new date with none when tables change each dinner", () => {
    const parties = [party("h1", 2, { seats: 8 }), party("c4", 2)];
    const fitted = fitDraft(
      saved([table("a", ["h1", "c4"], [["d1", "h1"]], "d1"), table("b", ["h1", "c4"], [["d2", "h1"]], "d2")]),
      "new_tables",
      ["d2", "d3"],
      ["h1", "c4"]
    )!;
    expect(fitted.tables.map((t) => t.key)).toEqual(["b"]);
    const warnings = draftWarnings(fitted, input(parties, { format: "new_tables", allowBackToBack: true, dateIds: ["d2", "d3"] }));
    expect(warnings.datesWithoutTables).toEqual(["d3"]);
    expect(blocksPublish(warnings)).toBe(true);
  });

  it("hosts a date added after publishing with the table's one host, so the tables can be published again", () => {
    const parties = [party("h1", 2, { seats: 8 }), party("c5", 2)];
    const published = draftFromPublished(
      [{ id: "T1", seasonDateId: null, position: 1, partyIds: ["h1", "c5"], hosts: [{ seasonDateId: "d1", partyId: "h1" }] }],
      "same_table_one_host",
      ["d1", "d2"],
      0
    );
    const fitted = fitDraft(published, "same_table_one_host", ["d1", "d2"], ["h1", "c5"])!;
    expect(fitted.tables[0].hosts).toEqual([
      { seasonDateId: "d1", partyId: "h1" },
      { seasonDateId: "d2", partyId: "h1" },
    ]);
    expect(blocksPublish(draftWarnings(fitted, input(parties, { dateIds: ["d1", "d2"] })))).toBe(false);
  });

  it("gives every date the first host when the format changes to one host all season", () => {
    const fitted = fitDraft(
      saved([table("a", ["h1", "h2"], [["d1", "h1"], ["d2", "h2"]])]),
      "same_table_one_host",
      ["d1", "d2"],
      ["h1", "h2"]
    )!;
    expect(fitted.tables[0].hosts.map((h) => h.partyId)).toEqual(["h1", "h1"]);
  });

  it("drops a draft saved with the other table shape when the format changed", () => {
    const perDate = saved([table("a", ["h1", "c4"], [["d1", "h1"]], "d1"), table("b", ["h1", "c4"], [["d2", "h1"]], "d2")]);
    expect(fitDraft(perDate, "same_table_one_host", ["d1", "d2"], ["h1", "c4"])).toBeNull();
    const allSeason = saved([table("a", ["h1", "c4"], [["d1", "h1"]])]);
    expect(fitDraft(allSeason, "new_tables", ["d1"], ["h1", "c4"])).toBeNull();
  });

  it("reads back a draft it wrote and nothing else", () => {
    const draft = shuffle(input(sevenCouplesThreeSingles()));
    expect(parseDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
    expect(parseDraft({})).toBeNull();
    expect(parseDraft({ version: 1, seed: 1, tables: [{ key: "a", partyIds: "h1" }] })).toBeNull();
  });
});

describe("shuffle, hosts whose seats add up but don't fit whole parties", () => {
  // Five couples, tables of up to 6, hosts with 5, 5 and 4 seats: two hosts
  // have 10 seats between them, but a five-seat table takes only two couples.
  const fiveCouples = () => [
    party("h1", 2, { seats: 5 }),
    party("h2", 2, { seats: 5 }),
    party("h3", 2, { seats: 4 }),
    party("c4", 2),
    party("c5", 2),
  ];
  const byId = new Map(fiveCouples().map((p) => [p.id, p]));

  it("adds a host so no table has more people than its host's seats", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const draft = shuffle(input(fiveCouples(), { tableSize: { min: 4, max: 6 }, seed }));
      expect(draft.tables).toHaveLength(3);
      for (const t of draft.tables) {
        const host = byId.get(t.hosts[0].partyId!)!;
        expect(partyPeople(t, byId)).toBeLessThanOrEqual(host.seats!);
      }
    }
  });

  it("adds a host at a dinner when tables change each dinner", () => {
    // Any two of these hosts have the 10 seats between them.
    const parties = fiveCouples().map((p) => (p.canHost ? { ...p, seats: 5 } : p));
    const seats = new Map(parties.map((p) => [p.id, p]));
    for (const seed of [1, 2, 3, 42, 99]) {
      const draft = shuffle(
        input(parties, { format: "new_tables", dateIds: ["d1"], tableSize: { min: 4, max: 6 }, allowBackToBack: true, seed })
      );
      expect(draft.tables).toHaveLength(3);
      for (const t of draft.tables) {
        const host = seats.get(t.hosts[0].partyId!)!;
        expect(partyPeople(t, seats)).toBeLessThanOrEqual(host.seats!);
      }
    }
  });
});
