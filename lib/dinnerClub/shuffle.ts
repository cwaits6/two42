// The dinner club shuffle: parties into tables, and who hosts each dinner.
// Pure and seeded, so a seed always gives the same draft. The draft it
// returns is what dinner_drafts.body stores and dinner_tables_publish()
// checks.

export const DINNER_FORMATS = ["same_table_one_host", "same_table_rotating", "new_tables"] as const;
export type DinnerFormat = (typeof DINNER_FORMATS)[number];

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

// Twelve starts find a seating with no repeat tablemates, where one exists,
// on seeds where six did not; a large season still shuffles well under a second.
const ATTEMPTS = 12;

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

/** Whether every table holds no more people than its seats. */
function fitsSeats(slots: Slot[], byId: Map<string, ShuffleParty>, capacity: (ids: string[]) => number): boolean {
  return slots.every((slot) => {
    const ids = [...slot.fixed, ...slot.members];
    return people(ids, byId) <= capacity(ids);
  });
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
    const seatWith = (count: number) => {
      const chosen = hosts.slice(0, count);
      const chosenIds = new Set(chosen.map((h) => h.id));
      const slots: Slot[] =
        chosen.length > 0
          ? chosen.map((h) => ({ fixed: [h.id], members: [] }))
          : Array.from({ length: count }, () => ({ fixed: [], members: [] }));
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
      return { seated, capacity };
    };
    // Seats add up without fitting when parties can't split across tables
    // (two five-seat tables can't take three couples), so try another host.
    let pick = seatWith(n);
    for (let more = n + 1; !fitsSeats(pick.seated, byId, pick.capacity) && more <= hosts.length; more++) {
      const next = seatWith(more);
      if (fitsSeats(next.seated, byId, next.capacity)) pick = next;
    }
    return pick.seated.map((slot, i) => ({
      key: `t${i + 1}`,
      tableId: null,
      seasonDateId: null,
      partyIds: [...slot.fixed, ...slot.members],
      hosts: input.dateIds.map((d) => ({ seasonDateId: d, partyId: slot.fixed[0] ?? null })),
    }));
  }

  // Hosts take turns: every host is dealt round-robin, so each table starts
  // with one, and the search keeps at least one at every table.
  const hostIds = new Set(hosts.map((h) => h.id));
  const capacity = (ids: string[]) => {
    const seats = ids.filter((id) => hostIds.has(id)).map((id) => byId.get(id)?.seats ?? 0);
    return seats.length > 0 ? Math.min(...seats) : input.tableSize.max;
  };
  const allowed = (ids: string[]) => hosts.length === 0 || ids.some((id) => hostIds.has(id));
  const seatWith = (count: number) => {
    const slots: Slot[] = Array.from({ length: count }, () => ({ fixed: [], members: [] }));
    hosts.forEach((h, i) => slots[i % count].members.push(h.id));
    return seat(
      slots,
      input.parties.filter((p) => !hostIds.has(p.id)).map((p) => p.id),
      { byId, capacity, allowed, seenPairs },
      rng
    );
  };
  const fits = (slots: Slot[]) => slots.every((slot) => people(slot.members, byId) <= capacity(slot.members));
  // Every host at a table takes a turn, so a table holds its smallest host's
  // seats; when it can't, more tables spread the small hosts out.
  let seated = seatWith(n);
  for (let more = n + 1; !fits(seated) && more <= hosts.length; more++) {
    const next = seatWith(more);
    if (fits(next)) seated = next;
  }

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
    let count = Math.min(needed, ranked.length);
    while (count < ranked.length && ranked.slice(0, count).reduce((a, p) => a + (p.seats ?? 0), 0) < total) count += 1;
    const seatWith = (n: number) => {
      const chosen = ranked.slice(0, n);
      const chosenIds = new Set(chosen.map((h) => h.id));
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
      return { chosen, chosenIds, seated, capacity };
    };
    let pick = seatWith(count);
    for (let more = count + 1; !fitsSeats(pick.seated, byId, pick.capacity) && more <= ranked.length; more++) {
      const next = seatWith(more);
      if (fitsSeats(next.seated, byId, next.capacity)) pick = next;
    }
    const { chosen, chosenIds, seated } = pick;
    chosen.forEach((h) => hosted.set(h.id, (hosted.get(h.id) ?? 0) + 1));

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
  /** Dates with no table, when tables change each dinner. */
  datesWithoutTables: string[];
}

/** Whether publish would refuse the draft: a dinner with no host, or a date with no table. */
export function blocksPublish(warnings: DraftWarnings): boolean {
  return warnings.datesWithoutTables.length > 0 || Object.values(warnings.tables).some((w) => w.noHost);
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

/** The key of a published table's dinner on one date, as in `heldDinners`. */
export function dinnerKey(tableId: string, seasonDateId: string): string {
  return `${tableId}:${seasonDateId}`;
}

export function draftWarnings(
  draft: Draft,
  input: Pick<ShuffleInput, "format" | "parties" | "dateIds" | "tableSize" | "allowBackToBack" | "pastPairs">,
  /** Dinners already held: they keep the host they had, so need none here. */
  heldDinners: ReadonlySet<string> = new Set()
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
    const held = (d: string) => t.tableId !== null && heldDinners.has(dinnerKey(t.tableId, d));
    const noHost = expected.some((d) => !held(d) && !t.hosts.some((h) => h.seasonDateId === d && h.partyId));
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
    datesWithoutTables:
      input.format === "new_tables" ? input.dateIds.filter((d) => !draft.tables.some((t) => t.seasonDateId === d)) : [],
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

/**
 * Moves a party to another table. A host who moves leaves their dates with no
 * host; a table the last party leaves is gone, since publish refuses an empty one.
 */
export function moveParty(draft: Draft, fromKey: string, partyId: string, toKey: string): Draft {
  if (fromKey === toKey) return draft;
  const to = draft.tables.find((t) => t.key === toKey);
  const from = draft.tables.find((t) => t.key === fromKey);
  if (!to || !from || !from.partyIds.includes(partyId) || to.seasonDateId !== from.seasonDateId) return draft;
  return withTables(
    draft,
    draft.tables
      .map((t) => {
        if (t.key === fromKey) return without(t, partyId);
        if (t.key === toKey) return { ...t, partyIds: [...t.partyIds, partyId] };
        return t;
      })
      .filter((t) => t.partyIds.length > 0)
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

/** Swaps who hosts two dates at one table, as when a host can't take their turn. */
export function swapHostTurns(draft: Draft, key: string, dateA: string, dateB: string): Draft {
  const t = draft.tables.find((x) => x.key === key);
  const a = t?.hosts.find((h) => h.seasonDateId === dateA)?.partyId;
  const b = t?.hosts.find((h) => h.seasonDateId === dateB)?.partyId;
  if (!a || !b || dateA === dateB) return draft;
  return setTableHost(setTableHost(draft, key, b, dateA), key, a, dateB);
}

/** The dates a table sits on: its own when tables change each dinner, every date otherwise. */
function tableDates(t: DraftTable, dateIds: readonly string[]): string[] {
  return t.seasonDateId ? [t.seasonDateId] : [...dateIds];
}

/** Free seats at a table: its host's seats, or the table size when it has no host yet. */
export function freeSeats(t: DraftTable, parties: Map<string, ShuffleParty>, tableSizeMax: number): number {
  return (tableSeats(t, parties) ?? tableSizeMax) - partyPeople(t, parties);
}

/**
 * Tables a party could join: with a dinner still to come, room for the whole
 * party, and the party not already seated on that table's date.
 */
export function tablesWithRoom(
  draft: Draft,
  party: ShuffleParty,
  parties: Map<string, ShuffleParty>,
  tableSizeMax: number,
  dateIds: readonly string[],
  futureDateIds: ReadonlySet<string>
): DraftTable[] {
  return draft.tables.filter(
    (t) =>
      tableDates(t, dateIds).some((d) => futureDateIds.has(d)) &&
      freeSeats(t, parties, tableSizeMax) >= party.size &&
      !draft.tables.some((o) => o.seasonDateId === t.seasonDateId && o.partyIds.includes(party.id))
  );
}

/** Seats a party at one table and changes no other. */
export function seatParty(draft: Draft, partyId: string, toKey: string): Draft {
  const to = draft.tables.find((t) => t.key === toKey);
  if (!to || draft.tables.some((t) => t.seasonDateId === to.seasonDateId && t.partyIds.includes(partyId))) return draft;
  return withTables(
    draft,
    draft.tables.map((t) => (t.key === toKey ? { ...t, partyIds: [...t.partyIds, partyId] } : t))
  );
}

/**
 * When a host can't host one dinner and tables change each dinner: spreads
 * that table's guests across the same night's other tables with room and
 * drops the table. Couples go first, then singles; each to the table with
 * the most free seats, then the fewest people they already shared a table
 * with this season or before, then the earlier table. The host, and any
 * party no table has room for, are left off that night for the leader to seat.
 */
export function moveGuests(
  draft: Draft,
  tableKey: string,
  parties: Map<string, ShuffleParty>,
  tableSizeMax: number,
  pastPairs: [string, string][]
): { draft: Draft; unplaced: string[] } {
  const from = draft.tables.find((t) => t.key === tableKey);
  if (!from?.seasonDateId) return { draft, unplaced: [] };
  const seen = seenFrom(pastPairs);
  for (const t of draft.tables) {
    if (t.seasonDateId === from.seasonDateId) continue;
    for (let a = 0; a < t.partyIds.length; a++) {
      for (let b = a + 1; b < t.partyIds.length; b++) seen.add(pairKey(t.partyIds[a], t.partyIds[b]));
    }
  }
  const hostIds = new Set(from.hosts.map((h) => h.partyId));
  const guests = from.partyIds.filter((id) => !hostIds.has(id));
  const order = [
    ...guests.filter((id) => parties.get(id)?.size === 2),
    ...guests.filter((id) => parties.get(id)?.size !== 2),
  ];
  let tables = draft.tables.filter((t) => t.key !== tableKey);
  const unplaced: string[] = [];
  for (const id of order) {
    const size = parties.get(id)?.size ?? 1;
    const rank = (t: DraftTable) => ({
      free: freeSeats(t, parties, tableSizeMax),
      repeats: t.partyIds.filter((other) => seen.has(pairKey(id, other))).length,
    });
    let best: DraftTable | null = null;
    let bestRank = { free: -Infinity, repeats: Infinity };
    for (const t of tables) {
      if (t.seasonDateId !== from.seasonDateId) continue;
      const r = rank(t);
      if (r.free < size) continue;
      if (r.free > bestRank.free || (r.free === bestRank.free && r.repeats < bestRank.repeats)) {
        best = t;
        bestRank = r;
      }
    }
    if (!best) {
      unplaced.push(id);
      continue;
    }
    const target = best.key;
    tables = tables.map((t) => (t.key === target ? { ...t, partyIds: [...t.partyIds, id] } : t));
  }
  return { draft: withTables(draft, tables), unplaced };
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


function isDraftTable(value: unknown): value is DraftTable {
  const t = value as DraftTable | null;
  return (
    typeof t?.key === "string" &&
    (t.tableId === null || typeof t.tableId === "string") &&
    (t.seasonDateId === null || typeof t.seasonDateId === "string") &&
    Array.isArray(t.partyIds) &&
    t.partyIds.every((id) => typeof id === "string") &&
    Array.isArray(t.hosts) &&
    t.hosts.every((h) => typeof h?.seasonDateId === "string" && (h.partyId === null || typeof h.partyId === "string"))
  );
}

/** A stored draft body, or null when it is not one. */
export function parseDraft(body: unknown): Draft | null {
  const d = body as Draft | null;
  if (d?.version !== 1 || typeof d.seed !== "number" || !Array.isArray(d.tables) || !d.tables.every(isDraftTable)) {
    return null;
  }
  return d;
}

/**
 * The host of a table kept all season with one host: the one hosting the most
 * dates, ties to the earliest. A published table keeps each date's own host,
 * since one dinner may have a stand-in, and gives this host to a date with none.
 */
function oneHost(hosts: (string | null)[], published: boolean): { host: string | null; perDate: boolean } {
  const counts = new Map<string, number>();
  hosts.forEach((id) => id && counts.set(id, (counts.get(id) ?? 0) + 1));
  let host: string | null = null;
  for (const id of hosts) {
    if (id && (host === null || (counts.get(id) ?? 0) > (counts.get(host) ?? 0))) host = id;
  }
  return { host: published ? host : (hosts.find((id) => id !== null) ?? null), perDate: published };
}

/**
 * A saved draft brought up to the season as it is now, or null when it was
 * saved under a format with the other table shape. Dates and parties change
 * after a draft is saved, and publish refuses a draft naming a date or party
 * that is gone. Parties no longer signed up leave their tables; a table kept
 * all season gets one host entry per current date, and with one host all
 * season every date takes that host, except on a published table, where a
 * date keeps its own; a date's tables go with the date.
 */
export function fitDraft(draft: Draft, format: DinnerFormat, dateIds: string[], partyIds: string[]): Draft | null {
  const perDate = format === "new_tables";
  if (draft.tables.some((t) => (t.seasonDateId !== null) !== perDate)) return null;
  const dates = new Set(dateIds);
  const parties = new Set(partyIds);
  const tables = draft.tables
    .filter((t) => !perDate || dates.has(t.seasonDateId as string))
    .map((t): DraftTable => {
      const seated = t.partyIds.filter((id) => parties.has(id));
      const hostOn = (d: string) => {
        const partyId = t.hosts.find((h) => h.seasonDateId === d)?.partyId ?? null;
        return partyId && seated.includes(partyId) ? partyId : null;
      };
      const kept = perDate ? [t.seasonDateId as string] : dateIds;
      const tableHost = format === "same_table_one_host" ? oneHost(kept.map(hostOn), t.tableId !== null) : undefined;
      return {
        ...t,
        partyIds: seated,
        hosts: kept.map((d) => ({
          seasonDateId: d,
          partyId: tableHost === undefined ? hostOn(d) : tableHost.perDate ? (hostOn(d) ?? tableHost.host) : tableHost.host,
        })),
      };
    })
    .filter((t) => t.partyIds.length > 0);
  return { ...draft, tables };
}
