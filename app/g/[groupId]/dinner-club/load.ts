// Server reads for the dinner club pages, on the cookie client: row security
// decides what each person gets, so a member reads only their own party and
// tables while a leader reads the whole season. Nothing here widens that.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShuffleParty } from "@/lib/dinnerClub/shuffle";
import { displayName } from "@/lib/names";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { readList } from "@/lib/supabase/readList";

type Client = SupabaseClient<Database>;

export type SeasonRow = Tables<"dinner_seasons">;
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
}

/** The group's seasons, newest first; a member's read leaves out drafts. */
export async function loadSeasons(supabase: Client, groupId: string): Promise<SeasonRow[] | null> {
  return readList(
    await supabase.from("dinner_seasons").select("*").eq("group_id", groupId).order("created_at", { ascending: false }),
    "dinner club seasons"
  );
}

export async function loadSeason(supabase: Client, groupId: string, seasonId: string): Promise<SeasonRow | null> {
  const { data } = await supabase
    .from("dinner_seasons")
    .select("*")
    .eq("group_id", groupId)
    .eq("id", seasonId)
    .maybeSingle();
  return data;
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
    supabase.from("dinner_seats").select("table_id, party_id, left_at").eq("season_id", seasonId),
    supabase
      .from("dinners")
      .select("id, table_id, season_date_id, starts_at, host_party_id, host_unavailable")
      .eq("season_id", seasonId)
      .order("starts_at"),
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
  const replies = dinnerIds.length
    ? readList(
        await supabase.from("dinner_replies").select("dinner_id, profile_id, status").in("dinner_id", dinnerIds),
        "dinner replies"
      )
    : [];
  if (replies === null) return null;
  return { ...(read as { [K in keyof typeof read]: NonNullable<(typeof read)[K]> }), replies };
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
