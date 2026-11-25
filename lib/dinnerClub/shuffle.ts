// The dinner club shuffle: parties into tables, and who hosts each dinner.
// Pure and seeded, so a seed always gives the same draft. The draft it
// returns is what dinner_drafts.body stores and dinner_tables_publish()
// checks.

export type DinnerFormat = "same_table_one_host" | "same_table_rotating" | "new_tables";

export interface ShuffleParty {
  id: string;
  size: 1 | 2;
  canHost: boolean;
  /** How many fit at their table, their own party included. */
  seats: number | null;
  preferredDateId: string | null;
  unavailableDateIds: string[];
}

export interface DraftHost {
  seasonDateId: string;
  partyId: string | null;
}

export interface DraftTable {
  key: string;
  /** The published table this is, once published. */
  tableId: string | null;
  /** Set when tables change each dinner; null for a table kept all season. */
  seasonDateId: string | null;
  partyIds: string[];
  hosts: DraftHost[];
}

export interface Draft {
  version: 1;
  seed: number;
  tables: DraftTable[];
}

export interface ShuffleInput {
  format: DinnerFormat;
  parties: ShuffleParty[];
  /** The season's dates, in date order. */
  dateIds: string[];
  tableSize: { min: number; max: number };
  allowBackToBack: boolean;
  /** Parties who shared a table before, kept apart where possible. */
  pastPairs: [string, string][];
  seed: number;
}

/** mulberry32: a small seeded generator, uniform on [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const OVER_SEATS = 1000;
const LONE_SINGLE = 1.5;
const REPEAT_PAIR = 1;

interface Slot {
  /** Parties the search never moves: a table's one host. */
  fixed: string[];
  members: string[];
}

interface SeatRules {
  byId: Map<string, ShuffleParty>;
  capacity: (partyIds: string[]) => number;
  /** False when a table may not be left as it would be, e.g. with no host. */
  allowed: (partyIds: string[]) => boolean;
  seenPairs: Set<string>;
}

function people(ids: string[], byId: Map<string, ShuffleParty>): number {
  return ids.reduce((sum, id) => sum + (byId.get(id)?.size ?? 0), 0);
}

function score(slots: Slot[], rules: SeatRules): number {
  const all = slots.map((s) => [...s.fixed, ...s.members]);
  const counts = all.map((ids) => people(ids, rules.byId));
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  const singlesTotal = all.flat().filter((id) => rules.byId.get(id)?.size === 1).length;
  let total = 0;
  all.forEach((ids, i) => {
    total += Math.max(0, counts[i] - rules.capacity(ids)) * OVER_SEATS;
    total += (counts[i] - mean) ** 2;
    const singles = ids.filter((id) => rules.byId.get(id)?.size === 1).length;
    if (singles === 1 && singlesTotal > 1) total += LONE_SINGLE;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        if (rules.seenPairs.has(pairKey(ids[a], ids[b]))) total += REPEAT_PAIR;
      }
    }
  });
  return total;
}

const ATTEMPTS = 6;

/**
 * Seats the movable parties several times from different seeded starts and
 * keeps the best. One move or swap at a time cannot carry two parties across
 * together, so the starts are what try the other groupings.
 */
function seat(base: Slot[], guests: string[], rules: SeatRules, rng: () => number): Slot[] {
  let best: Slot[] = [];
  let bestScore = Infinity;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const slots = base.map((s) => ({ fixed: [...s.fixed], members: [...s.members] }));
    const result = seatOnce(slots, guests, rules, rng);
    const s = score(result, rules);
    if (s < bestScore - 1e-9) {
      best = result;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Places the movable parties, then improves the seating one move or swap at
 * a time, trying them in a seeded order, until nothing improves.
 */
function seatOnce(slots: Slot[], guests: string[], rules: SeatRules, rng: () => number): Slot[] {
  const order = [
    ...shuffled(guests.filter((id) => rules.byId.get(id)?.size === 2), rng),
    ...shuffled(guests.filter((id) => rules.byId.get(id)?.size !== 2), rng),
  ];
  for (const id of order) {
    let best = -1;
    let bestFill = Infinity;
    slots.forEach((slot, i) => {
      const ids = [...slot.fixed, ...slot.members];
      const fill = (people(ids, rules.byId) + (rules.byId.get(id)?.size ?? 0)) / Math.max(1, rules.capacity(ids));
      if (fill < bestFill) {
        bestFill = fill;
        best = i;
      }
    });
    if (best >= 0) slots[best].members.push(id);
  }

  let current = score(slots, rules);
  for (let round = 0; round < 200; round++) {
    let improved = false;
    const candidates: [number, number, number, number][] = [];
    slots.forEach((from, fi) =>
      from.members.forEach((_, mi) =>
        slots.forEach((to, ti) => {
          if (ti === fi) return;
          candidates.push([fi, mi, ti, -1]);
          to.members.forEach((__, mj) => candidates.push([fi, mi, ti, mj]));
        })
      )
    );
    for (const [fi, mi, ti, mj] of shuffled(candidates, rng)) {
      const next = slots.map((s) => ({ fixed: s.fixed, members: [...s.members] }));
      const [moving] = next[fi].members.splice(mi, 1);
      if (mj >= 0) {
        const [back] = next[ti].members.splice(mj, 1, moving);
        next[fi].members.push(back);
      } else {
        next[ti].members.push(moving);
      }
      if (!rules.allowed([...next[fi].fixed, ...next[fi].members])) continue;
      if (!rules.allowed([...next[ti].fixed, ...next[ti].members])) continue;
      const s = score(next, rules);
      if (s < current - 1e-9) {
        slots.splice(0, slots.length, ...next);
        current = s;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return slots;
}

/**
 * How many tables: enough that none goes over the table size, and, picking
 * hosts with the most seats first, enough seats for everyone. Never more
 * than there are hosts.
 */
function tableCount(totalPeople: number, max: number, hostSeats: number[]): number {
  if (hostSeats.length === 0) return Math.max(1, Math.ceil(totalPeople / max));
  const sorted = [...hostSeats].sort((a, b) => b - a);
  let n = Math.max(1, Math.ceil(totalPeople / max));
  while (n < sorted.length && sorted.slice(0, n).reduce((a, b) => a + b, 0) < totalPeople) n += 1;
  return Math.min(n, sorted.length);
}

function seenFrom(pastPairs: [string, string][]): Set<string> {
  return new Set(pastPairs.map(([a, b]) => pairKey(a, b)));
}

function sameTable(input: ShuffleInput, rng: () => number): DraftTable[] {
  const byId = new Map(input.parties.map((p) => [p.id, p]));
  const total = people(input.parties.map((p) => p.id), byId);
  const hosts = shuffled(
    input.parties.filter((p) => p.canHost),
    rng
  ).sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0));
  const n = tableCount(total, input.tableSize.max, hosts.map((h) => h.seats ?? 0));
  const seenPairs = seenFrom(input.pastPairs);

  if (input.format === "same_table_one_host") {
    const chosen = hosts.slice(0, n);
    const chosenIds = new Set(chosen.map((h) => h.id));
    const slots: Slot[] =
      chosen.length > 0
        ? chosen.map((h) => ({ fixed: [h.id], members: [] }))
        : Array.from({ length: n }, () => ({ fixed: [], members: [] }));
    const capacity = (ids: string[]) => {
      const host = ids.map((id) => byId.get(id)).find((p) => p && chosenIds.has(p.id));
      return host?.seats ?? input.tableSize.max;
    };
    const seated = seat(
      slots,
      input.parties.filter((p) => !chosenIds.has(p.id)).map((p) => p.id),
      { byId, capacity, allowed: () => true, seenPairs },
      rng
    );
    return seated.map((slot, i) => ({
      key: `t${i + 1}`,
      tableId: null,
      seasonDateId: null,
      partyIds: [...slot.fixed, ...slot.members],
      hosts: input.dateIds.map((d) => ({ seasonDateId: d, partyId: slot.fixed[0] ?? null })),
    }));
  }

  // Hosts take turns: every host is dealt round-robin, so each table starts
  // with one, and the search keeps at least one at every table.
  const slots: Slot[] = Array.from({ length: n }, () => ({ fixed: [], members: [] }));
  hosts.forEach((h, i) => slots[i % n].members.push(h.id));
  const hostIds = new Set(hosts.map((h) => h.id));
  const capacity = (ids: string[]) => {
    const seats = ids.filter((id) => hostIds.has(id)).map((id) => byId.get(id)?.seats ?? 0);
    return seats.length > 0 ? Math.min(...seats) : input.tableSize.max;
  };
  const allowed = (ids: string[]) => hosts.length === 0 || ids.some((id) => hostIds.has(id));
  const seated = seat(
    slots,
    input.parties.filter((p) => !hostIds.has(p.id)).map((p) => p.id),
    { byId, capacity, allowed, seenPairs },
    rng
  );

  return seated.map((slot, i) => {
    const partyIds = [...slot.members];
    const tableHosts = partyIds.filter((id) => hostIds.has(id));
    const turns = new Map(tableHosts.map((id) => [id, 0]));
    const order = shuffled(tableHosts, rng);
    const assigned = input.dateIds.map((d) => {
      if (order.length === 0) return { seasonDateId: d, partyId: null };
      const fewest = Math.min(...order.map((id) => turns.get(id) ?? 0));
      const due = order.filter((id) => turns.get(id) === fewest);
      const pick = due.find((id) => byId.get(id)?.preferredDateId === d) ?? due[0];
      turns.set(pick, fewest + 1);
      return { seasonDateId: d, partyId: pick };
    });
    return { key: `t${i + 1}`, tableId: null, seasonDateId: null, partyIds, hosts: assigned };
  });
}

function newTables(input: ShuffleInput, rng: () => number): DraftTable[] {
  const byId = new Map(input.parties.map((p) => [p.id, p]));
  const total = people(input.parties.map((p) => p.id), byId);
  const seenPairs = seenFrom(input.pastPairs);
  const hosted = new Map<string, number>();
  let previousHosts = new Set<string>();
  const tables: DraftTable[] = [];

  input.dateIds.forEach((dateId, index) => {
    const free = input.parties.filter((p) => p.canHost && !p.unavailableDateIds.includes(dateId));
    const rested = input.allowBackToBack ? free : free.filter((p) => !previousHosts.has(p.id));
    // Fewest dinners hosted first; then a host who can't host the next
    // dinner anyway, which leaves more hosts rested for it.
    const nextDate = input.dateIds[index + 1];
    const awayNext = (p: ShuffleParty) => (nextDate && p.unavailableDateIds.includes(nextDate) ? 0 : 1);
    const fair = (pool: ShuffleParty[]) =>
      shuffled(pool, rng).sort(
        (a, b) => (hosted.get(a.id) ?? 0) - (hosted.get(b.id) ?? 0) || awayNext(a) - awayNext(b)
      );
    const needed = tableCount(total, input.tableSize.max, free.map((p) => p.seats ?? 0));
    // Someone hosts two in a row only when there are too few hosts otherwise.
    const ranked = [...fair(rested), ...fair(free.filter((p) => !rested.includes(p)))];
    let chosen = ranked.slice(0, needed);
    while (chosen.length < ranked.length && chosen.reduce((a, p) => a + (p.seats ?? 0), 0) < total) {
      chosen = ranked.slice(0, chosen.length + 1);
    }
    const chosenIds = new Set(chosen.map((h) => h.id));
    chosen.forEach((h) => hosted.set(h.id, (hosted.get(h.id) ?? 0) + 1));

    const slots: Slot[] =
      chosen.length > 0
        ? chosen.map((h) => ({ fixed: [h.id], members: [] }))
        : [{ fixed: [], members: [] }];
    const capacity = (ids: string[]) => {
      const host = ids.find((id) => chosenIds.has(id));
      return (host && byId.get(host)?.seats) || input.tableSize.max;
    };
    const seated = seat(
      slots,
      input.parties.filter((p) => !chosenIds.has(p.id)).map((p) => p.id),
      { byId, capacity, allowed: () => true, seenPairs },
      rng
    );
    seated.forEach((slot, i) => {
      const partyIds = [...slot.fixed, ...slot.members];
      for (let a = 0; a < partyIds.length; a++) {
        for (let b = a + 1; b < partyIds.length; b++) seenPairs.add(pairKey(partyIds[a], partyIds[b]));
      }
      tables.push({
        key: `${dateId}:${i + 1}`,
        tableId: null,
        seasonDateId: dateId,
        partyIds,
        hosts: [{ seasonDateId: dateId, partyId: slot.fixed[0] ?? null }],
      });
    });
    previousHosts = chosenIds;
  });
  return tables;
}

export function shuffle(input: ShuffleInput): Draft {
  const rng = mulberry32(input.seed);
  const tables = input.format === "new_tables" ? newTables(input, rng) : sameTable(input, rng);
  return { version: 1, seed: input.seed, tables };
}

// ── Warnings ────────────────────────────────────────────────────────────────

export interface TableWarnings {
  overSeats: boolean;
  /** A date at this table with nobody hosting. */
  noHost: boolean;
  /** Pairs of parties at this table who already shared one. */
  repeatPairs: [string, string][];
  /** Hosts here who also hosted the dinner before. */
  backToBack: string[];
}

export interface DraftWarnings {
  tables: Record<string, TableWarnings>;
  tooFewHosts: boolean;
}

export function partyPeople(draftTable: DraftTable, parties: Map<string, ShuffleParty>): number {
  return draftTable.partyIds.reduce((sum, id) => sum + (parties.get(id)?.size ?? 0), 0);
}

/** The most people a table holds: its host's seats, or the fewest of its hosts' when they take turns. */
export function tableSeats(draftTable: DraftTable, parties: Map<string, ShuffleParty>): number | null {
  const hostIds = [...new Set(draftTable.hosts.map((h) => h.partyId).filter((id): id is string => Boolean(id)))];
  const seats = hostIds.map((id) => parties.get(id)?.seats ?? 0);
  return seats.length > 0 ? Math.min(...seats) : null;
}

/**
 * Hosts needed: people divided by the table size, rounded up. For tables that
 * change each dinner, each dinner needs that many of its own.
 */
export function hostsNeeded(totalPeople: number, tableSizeMax: number): number {
  return totalPeople === 0 ? 0 : Math.ceil(totalPeople / Math.max(1, tableSizeMax));
}

export function tooFewHosts(
  format: DinnerFormat,
  parties: ShuffleParty[],
  dateIds: string[],
  tableSizeMax: number
): boolean {
  const needed = hostsNeeded(
    parties.reduce((sum, p) => sum + p.size, 0),
    tableSizeMax
  );
  const hosts = parties.filter((p) => p.canHost);
  if (format !== "new_tables" || dateIds.length === 0) return hosts.length < needed;
  return dateIds.some((d) => hosts.filter((p) => !p.unavailableDateIds.includes(d)).length < needed);
}

export function draftWarnings(
  draft: Draft,
  input: Pick<ShuffleInput, "format" | "parties" | "dateIds" | "tableSize" | "allowBackToBack" | "pastPairs">
): DraftWarnings {
  const parties = new Map(input.parties.map((p) => [p.id, p]));
  const seen = seenFrom(input.pastPairs);
  const dateOrder = new Map(input.dateIds.map((d, i) => [d, i]));
  const ordered = [...draft.tables].sort(
    (a, b) => (dateOrder.get(a.seasonDateId ?? "") ?? -1) - (dateOrder.get(b.seasonDateId ?? "") ?? -1)
  );
  const hostsByDate = new Map<string, Set<string>>();
  draft.tables.forEach((t) =>
    t.hosts.forEach((h) => {
      if (!h.partyId) return;
      if (!hostsByDate.has(h.seasonDateId)) hostsByDate.set(h.seasonDateId, new Set());
      hostsByDate.get(h.seasonDateId)!.add(h.partyId);
    })
  );

  const tables: Record<string, TableWarnings> = {};
  for (const t of ordered) {
    const seats = tableSeats(t, parties);
    const expected = input.format === "new_tables" ? (t.seasonDateId ? [t.seasonDateId] : []) : input.dateIds;
    const noHost = expected.some((d) => !t.hosts.some((h) => h.seasonDateId === d && h.partyId));
    const repeatPairs: [string, string][] = [];
    for (let a = 0; a < t.partyIds.length; a++) {
      for (let b = a + 1; b < t.partyIds.length; b++) {
        if (seen.has(pairKey(t.partyIds[a], t.partyIds[b]))) repeatPairs.push([t.partyIds[a], t.partyIds[b]]);
      }
    }
    const backToBack: string[] = [];
    if (input.format === "new_tables" && !input.allowBackToBack && t.seasonDateId) {
      const i = dateOrder.get(t.seasonDateId) ?? 0;
      const before = i > 0 ? hostsByDate.get(input.dateIds[i - 1]) : undefined;
      t.hosts.forEach((h) => {
        if (h.partyId && before?.has(h.partyId)) backToBack.push(h.partyId);
      });
    }
    tables[t.key] = {
      overSeats: seats !== null && partyPeople(t, parties) > seats,
      noHost,
      repeatPairs,
      backToBack,
    };
    if (input.format === "new_tables") {
      for (let a = 0; a < t.partyIds.length; a++) {
        for (let b = a + 1; b < t.partyIds.length; b++) seen.add(pairKey(t.partyIds[a], t.partyIds[b]));
      }
    }
  }
  return {
    tables,
    tooFewHosts: tooFewHosts(input.format, input.parties, input.dateIds, input.tableSize.max),
  };
}

// ── Manual changes to a draft ───────────────────────────────────────────────

function withTables(draft: Draft, tables: DraftTable[]): Draft {
  return { ...draft, tables };
}

function without(t: DraftTable, partyId: string): DraftTable {
  return {
    ...t,
    partyIds: t.partyIds.filter((id) => id !== partyId),
    hosts: t.hosts.map((h) => (h.partyId === partyId ? { ...h, partyId: null } : h)),
  };
}

/** Moves a party to another table. A host who moves leaves their dates with no host. */
export function moveParty(draft: Draft, fromKey: string, partyId: string, toKey: string): Draft {
  if (fromKey === toKey) return draft;
  const to = draft.tables.find((t) => t.key === toKey);
  const from = draft.tables.find((t) => t.key === fromKey);
  if (!to || !from || !from.partyIds.includes(partyId) || to.seasonDateId !== from.seasonDateId) return draft;
  return withTables(
    draft,
    draft.tables.map((t) => {
      if (t.key === fromKey) return without(t, partyId);
      if (t.key === toKey) return { ...t, partyIds: [...t.partyIds, partyId] };
      return t;
    })
  );
}

/** Swaps two parties at different tables; each takes the other's hosting. */
export function swapParties(draft: Draft, keyA: string, partyA: string, keyB: string, partyB: string): Draft {
  if (keyA === keyB) return draft;
  const a = draft.tables.find((t) => t.key === keyA);
  const b = draft.tables.find((t) => t.key === keyB);
  if (!a || !b || !a.partyIds.includes(partyA) || !b.partyIds.includes(partyB) || a.seasonDateId !== b.seasonDateId) {
    return draft;
  }
  const swap = (t: DraftTable, out: string, into: string): DraftTable => ({
    ...t,
    partyIds: t.partyIds.map((id) => (id === out ? into : id)),
    hosts: t.hosts.map((h) => (h.partyId === out ? { ...h, partyId: into } : h)),
  });
  return withTables(
    draft,
    draft.tables.map((t) => (t.key === keyA ? swap(t, partyA, partyB) : t.key === keyB ? swap(t, partyB, partyA) : t))
  );
}

/** Makes a party at the table its host: for one date, or for every date when none is given. */
export function setTableHost(draft: Draft, key: string, partyId: string, seasonDateId?: string): Draft {
  return withTables(
    draft,
    draft.tables.map((t) => {
      if (t.key !== key || !t.partyIds.includes(partyId)) return t;
      return {
        ...t,
        hosts: t.hosts.map((h) => (!seasonDateId || h.seasonDateId === seasonDateId ? { ...h, partyId } : h)),
      };
    })
  );
}

export interface PublishedTable {
  id: string;
  seasonDateId: string | null;
  position: number;
  partyIds: string[];
  hosts: DraftHost[];
}

/**
 * A draft of the published tables, to change and publish again. Every date
 * of a table kept all season gets an entry, so a date added after publishing
 * shows up with no host until one is picked.
 */
export function draftFromPublished(tables: PublishedTable[], format: DinnerFormat, dateIds: string[], seed: number): Draft {
  return {
    version: 1,
    seed,
    tables: [...tables]
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        key: t.id,
        tableId: t.id,
        seasonDateId: t.seasonDateId,
        partyIds: [...t.partyIds],
        hosts: (format === "new_tables" ? [t.seasonDateId ?? ""] : dateIds).map((d) => ({
          seasonDateId: d,
          partyId: t.hosts.find((h) => h.seasonDateId === d)?.partyId ?? null,
        })),
      })),
  };
}

