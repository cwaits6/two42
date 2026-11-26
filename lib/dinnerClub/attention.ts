import type { SeasonStatus } from "./labels";
import { draftFromPublished, freeSeats, type DinnerFormat, type ShuffleParty } from "./shuffle";

export interface SeasonAttention {
  /** Dinners still to come whose host said they can't host and is still in the season. */
  cantHost: string[];
  /** Dinners still to come whose host has withdrawn, or that have none. */
  hostLeft: string[];
  /** Parties waiting for a table. */
  waiting: string[];
  /** Tables with a dinner still to come and a free seat, when someone is waiting. */
  room: { tableId: string; seasonDateId: string | null; free: number }[];
}

export const NOTHING_NEEDED: SeasonAttention = { cantHost: [], hostLeft: [], waiting: [], room: [] };

/** Dinners whose host said they can't host and has not withdrawn from the season. */
export function cantHostDinners<D extends { host_party_id: string | null; host_unavailable: boolean }>(
  dinners: D[],
  parties: { id: string; status: string }[]
): (D & { host_party_id: string })[] {
  const withdrawn = new Set(parties.filter((p) => p.status === "withdrawn").map((p) => p.id));
  return dinners.filter(
    (d): d is D & { host_party_id: string } =>
      d.host_unavailable && d.host_party_id !== null && !withdrawn.has(d.host_party_id)
  );
}

/** What a leader should sort out in a running season: hosts who can't host or left, and who is waiting. */
export function seasonAttention(input: {
  status: SeasonStatus;
  format: DinnerFormat;
  parties: { id: string; status: string }[];
  /** The parties still in the season, with their sizes and seats. */
  shuffleParties: ShuffleParty[];
  tables: { id: string; season_date_id: string | null; position: number }[];
  seats: { table_id: string; party_id: string; left_at: string | null }[];
  dinners: {
    id: string;
    table_id: string;
    season_date_id: string;
    starts_at: string;
    host_party_id: string | null;
    host_unavailable: boolean;
  }[];
  dateIds: string[];
  tableSizeMax: number;
  now: Date;
}): SeasonAttention {
  if (input.status !== "published") return NOTHING_NEEDED;
  const future = input.dinners.filter((d) => new Date(d.starts_at) > input.now);
  const byId = new Map(input.shuffleParties.map((p) => [p.id, p]));
  const withdrawn = new Set(input.parties.filter((p) => p.status === "withdrawn").map((p) => p.id));
  const waiting = input.parties.filter((p) => p.status === "waitlisted").map((p) => p.id);

  const futureTables = new Set(future.map((d) => d.table_id));
  const draft = draftFromPublished(
    input.tables
      .filter((t) => futureTables.has(t.id))
      .map((t) => ({
        id: t.id,
        seasonDateId: t.season_date_id,
        position: t.position,
        partyIds: input.seats.filter((s) => s.table_id === t.id && !s.left_at).map((s) => s.party_id),
        hosts: future
          .filter((d) => d.table_id === t.id && d.host_party_id && byId.has(d.host_party_id))
          .map((d) => ({ seasonDateId: d.season_date_id, partyId: d.host_party_id })),
      })),
    input.format,
    input.dateIds,
    0
  );

  const hostLeft = future.filter((d) => !d.host_party_id || withdrawn.has(d.host_party_id)).map((d) => d.id);
  return {
    cantHost: cantHostDinners(future, input.parties).map((d) => d.id),
    hostLeft,
    waiting,
    room:
      waiting.length === 0
        ? []
        : draft.tables.flatMap((t) => {
            const free = freeSeats(t, byId, input.tableSizeMax);
            return free > 0 ? [{ tableId: t.tableId as string, seasonDateId: t.seasonDateId, free }] : [];
          }),
  };
}
