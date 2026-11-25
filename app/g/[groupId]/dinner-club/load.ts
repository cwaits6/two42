// Server reads for the dinner club pages, on the cookie client: row security
// decides what each person gets, so a member reads only their own party and
// tables while a leader reads the whole season. Nothing here widens that.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDinnerFormat, isSeasonStatus, type SeasonStatus } from "@/lib/dinnerClub/labels";
import type { DinnerFormat, ShuffleParty } from "@/lib/dinnerClub/shuffle";
import { logError } from "@/lib/log";
import { displayName } from "@/lib/names";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { readList } from "@/lib/supabase/readList";

type Client = SupabaseClient<Database>;

export type SeasonRow = Omit<Tables<"dinner_seasons">, "format" | "status"> & {
  format: DinnerFormat;
  status: SeasonStatus;
};
export type PartyRow = Tables<"dinner_parties">;
export type AddressRow = Pick<
  Tables<"dinner_party_addresses">,
  "party_id" | "address_line1" | "address_line2" | "city" | "state" | "postal_code"
>;

export interface Person {
  id: string;
  name: string;
  firstName: string;
  familyId: string | null;
}

export interface SeasonData {
  dates: { id: string; starts_at: string }[];
  parties: PartyRow[];
  members: { party_id: string; profile_id: string }[];
  addresses: AddressRow[];
  notes: { party_id: string; food_notes: string }[];
  unavailable: { party_id: string; season_date_id: string }[];
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
  replies: { dinner_id: string; profile_id: string; status: string }[];
  /** What each guest party brings, for the dinners the caller may read. */
  contributions: { dinner_id: string; party_id: string; item: string }[];
}

function seasonRows(rows: Tables<"dinner_seasons">[]): SeasonRow[] {
  return rows.flatMap(({ format, status, ...row }) => {
    if (isDinnerFormat(format) && isSeasonStatus(status)) return [{ ...row, format, status }];
    logError("Dinner club season has a format or status the app does not know", undefined, {
      route: "/g/[groupId]/dinner-club",
      ids: { seasonId: row.id },
    });
    return [];
  });
}

/** The group's seasons, newest first; a member's read leaves out drafts. */
export async function loadSeasons(supabase: Client, groupId: string): Promise<SeasonRow[] | null> {
  const rows = readList(
    await supabase.from("dinner_seasons").select("*").eq("group_id", groupId).order("created_at", { ascending: false }),
    "dinner club seasons"
  );
  return rows && seasonRows(rows);
}

/** One season: `{ season: null }` when the caller has no such season, null when the read failed. */
export async function loadSeason(
  supabase: Client,
  groupId: string,
  seasonId: string
): Promise<{ season: SeasonRow | null } | null> {
  const rows = readList(
    await supabase.from("dinner_seasons").select("*").eq("group_id", groupId).eq("id", seasonId).limit(1),
    "dinner club season"
  );
  return rows && { season: seasonRows(rows)[0] ?? null };
}

/** The season the dinner club page is about: one taking sign-ups or running, then a leader's draft, then the last ended. */
export function currentSeason(seasons: SeasonRow[]): SeasonRow | null {
  return (
    seasons.find((s) => s.status === "open" || s.status === "published") ??
    seasons.find((s) => s.status === "draft") ??
    seasons.find((s) => s.status === "ended") ??
    null
  );
}

/** Everything about one season the caller may read. Null when a read failed. */
export async function loadSeasonData(supabase: Client, seasonId: string): Promise<SeasonData | null> {
  const [dates, parties, members, addresses, notes, unavailable, tables, seats, dinners] = await Promise.all([
    supabase.from("dinner_season_dates").select("id, starts_at").eq("season_id", seasonId).order("starts_at"),
    supabase.from("dinner_parties").select("*").eq("season_id", seasonId).order("created_at"),
    supabase.from("dinner_party_members").select("party_id, profile_id").eq("season_id", seasonId).order("created_at"),
    supabase
      .from("dinner_party_addresses")
      .select("party_id, address_line1, address_line2, city, state, postal_code")
      .eq("season_id", seasonId),
    supabase.from("dinner_party_notes").select("party_id, food_notes").eq("season_id", seasonId),
    supabase.from("dinner_party_unavailable_dates").select("party_id, season_date_id").eq("season_id", seasonId),
    supabase.from("dinner_tables").select("id, season_date_id, position").eq("season_id", seasonId).order("position"),
    // Seats, dinners and replies grow with parties times dates, so they page.
    fetchAll((from, to) =>
      supabase
        .from("dinner_seats")
        .select("table_id, party_id, left_at")
        .eq("season_id", seasonId)
        .order("table_id")
        .order("party_id")
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from("dinners")
        .select("id, table_id, season_date_id, starts_at, host_party_id, host_unavailable")
        .eq("season_id", seasonId)
        .order("starts_at")
        .order("id")
        .range(from, to)
    ),
  ]);
  const read = {
    dates: readList(dates, "dinner club dates"),
    parties: readList(parties, "dinner club parties"),
    members: readList(members, "dinner club party members"),
    addresses: readList(addresses, "dinner club addresses"),
    notes: readList(notes, "dinner club food notes"),
    unavailable: readList(unavailable, "dinner club unavailable dates"),
    tables: readList(tables, "dinner club tables"),
    seats: readList(seats, "dinner club seats"),
    dinners: readList(dinners, "dinners"),
  };
  if (Object.values(read).some((rows) => rows === null)) return null;

  const dinnerIds = read.dinners!.map((d) => d.id);
  const [replies, contributions] = dinnerIds.length
    ? await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("dinner_replies")
            .select("dinner_id, profile_id, status")
            .in("dinner_id", dinnerIds)
            .order("dinner_id")
            .order("profile_id")
            .range(from, to)
        ).then((r) => readList(r, "dinner replies")),
        fetchAll((from, to) =>
          supabase
            .from("dinner_contributions")
            .select("dinner_id, party_id, item")
            .eq("season_id", seasonId)
            .order("dinner_id")
            .order("party_id")
            .range(from, to)
        ).then((r) => readList(r, "dinner contributions")),
      ])
    : [[], []];
  if (replies === null || contributions === null) return null;
  return { ...(read as { [K in keyof typeof read]: NonNullable<(typeof read)[K]> }), replies, contributions };
}

/** The group's approved members, by name. */
export async function loadGroupPeople(supabase: Client, groupId: string): Promise<Person[] | null> {
  const members = readList(
    await supabase.from("group_members").select("profile_id").eq("group_id", groupId),
    "dinner club group members"
  );
  if (!members) return null;
  return loadPeople(
    supabase,
    members.map((m) => m.profile_id)
  );
}

export async function loadPeople(supabase: Client, ids: string[]): Promise<Person[] | null> {
  if (ids.length === 0) return [];
  const rows = readList(
    await supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, family_id, role")
      .in("id", [...new Set(ids)]),
    "dinner club names"
  );
  if (!rows) return null;
  return rows
    .filter((p) => p.role !== "pending")
    .map((p) => ({
      id: p.id,
      name: displayName(p),
      firstName: p.preferred_name?.trim() || p.first_name?.trim() || displayName(p),
      familyId: p.family_id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function peopleOf(data: Pick<SeasonData, "members">, partyId: string): string[] {
  return data.members.filter((m) => m.party_id === partyId).map((m) => m.profile_id);
}

export function shuffleParties(data: SeasonData): ShuffleParty[] {
  return data.parties
    .filter((p) => p.status !== "withdrawn")
    .map((p) => ({
      id: p.id,
      size: peopleOf(data, p.id).length === 2 ? 2 : 1,
      canHost: p.can_host,
      seats: p.seats,
      preferredDateId: p.preferred_season_date_id,
      unavailableDateIds: data.unavailable.filter((u) => u.party_id === p.id).map((u) => u.season_date_id),
    }));
}

/**
 * The tables of the two seasons before this one, as each table's parties'
 * people, for the shuffle to keep tablemates apart. A leader reads every
 * season of the group; a season since deleted ends the chain. Null when a
 * read failed.
 */
export async function loadPastTables(supabase: Client, season: SeasonRow): Promise<string[][][] | null> {
  const seasonIds: string[] = [];
  let previous = season.previous_season_id;
  while (previous && seasonIds.length < 2) {
    seasonIds.push(previous);
    const rows = readList(
      await supabase.from("dinner_seasons").select("previous_season_id").eq("id", previous).limit(1),
      "dinner club earlier season"
    );
    if (!rows) return null;
    previous = rows[0]?.previous_season_id ?? null;
  }
  if (seasonIds.length === 0) return [];
  const [seats, members] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("dinner_seats")
        .select("table_id, party_id")
        .in("season_id", seasonIds)
        .order("table_id")
        .order("party_id")
        .range(from, to)
    ).then((r) => readList(r, "dinner club earlier seats")),
    fetchAll((from, to) =>
      supabase
        .from("dinner_party_members")
        .select("party_id, profile_id")
        .in("season_id", seasonIds)
        .order("party_id")
        .order("profile_id")
        .range(from, to)
    ).then((r) => readList(r, "dinner club earlier party members")),
  ]);
  if (!seats || !members) return null;
  const tables = new Map<string, string[][]>();
  for (const seat of seats) {
    const people = members.filter((m) => m.party_id === seat.party_id).map((m) => m.profile_id);
    tables.set(seat.table_id, [...(tables.get(seat.table_id) ?? []), people]);
  }
  return [...tables.values()];
}

/** A person's own party last season, to sign up again from. */
export interface LastSeasonSignUp {
  partnerId: string | null;
  canHost: boolean;
  seats: number | null;
  kidsWelcome: boolean;
  accessNotes: string;
  pets: string;
  address: AddressRow | null;
  foodNotes: string;
}

/**
 * The caller's party in the season before, unless it withdrew. Row security
 * gives a member only their own party's rows, so nothing here is anyone
 * else's. Null when there is none or a read failed: the form then starts empty.
 */
export async function loadLastSeasonSignUp(
  supabase: Client,
  previousSeasonId: string,
  meId: string
): Promise<LastSeasonSignUp | null> {
  const mine = readList(
    await supabase
      .from("dinner_party_members")
      .select("party_id")
      .eq("season_id", previousSeasonId)
      .eq("profile_id", meId)
      .limit(1),
    "dinner club last season party"
  );
  const partyId = mine?.[0]?.party_id;
  if (!partyId) return null;
  const [party, members, address, notes] = await Promise.all([
    supabase.from("dinner_parties").select("*").eq("id", partyId).limit(1),
    supabase.from("dinner_party_members").select("profile_id").eq("party_id", partyId),
    supabase
      .from("dinner_party_addresses")
      .select("party_id, address_line1, address_line2, city, state, postal_code")
      .eq("party_id", partyId)
      .limit(1),
    supabase.from("dinner_party_notes").select("food_notes").eq("party_id", partyId).limit(1),
  ]);
  const read = {
    party: readList(party, "dinner club last season party"),
    members: readList(members, "dinner club last season party members"),
    address: readList(address, "dinner club last season address"),
    notes: readList(notes, "dinner club last season food notes"),
  };
  const row = read.party?.[0];
  if (!row || row.status === "withdrawn" || !read.members || !read.address || !read.notes) return null;
  return {
    partnerId: read.members.map((m) => m.profile_id).find((id) => id !== meId) ?? null,
    canHost: row.can_host,
    seats: row.seats,
    kidsWelcome: row.kids_welcome ?? false,
    accessNotes: row.access_notes ?? "",
    pets: row.pets ?? "",
    address: read.address[0] ?? null,
    foodNotes: read.notes[0]?.food_notes ?? "",
  };
}
