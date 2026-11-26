// Server reads for the Supper club pages, on the cookie client: row security
// decides what each person gets, so a member reads only their own party and
// tables while a leader reads the whole rotation. Nothing here widens that.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupperFormat, isRotationStatus, type RotationStatus } from "@/lib/supperClub/labels";
import type { SupperFormat, ShuffleParty } from "@/lib/supperClub/shuffle";
import { logError } from "@/lib/log";
import { displayName } from "@/lib/names";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { readList } from "@/lib/supabase/readList";

type Client = SupabaseClient<Database>;

export type RotationRow = Omit<Tables<"supper_rotations">, "format" | "status"> & {
  format: SupperFormat;
  status: RotationStatus;
};
export type PartyRow = Tables<"supper_parties">;
export type AddressRow = Pick<
  Tables<"supper_party_addresses">,
  "party_id" | "address_line1" | "address_line2" | "city" | "state" | "postal_code"
>;

export interface Person {
  id: string;
  name: string;
  firstName: string;
  familyId: string | null;
}

export interface RotationData {
  dates: { id: string; starts_at: string }[];
  parties: PartyRow[];
  members: { party_id: string; profile_id: string }[];
  addresses: AddressRow[];
  notes: { party_id: string; food_notes: string }[];
  unavailable: { party_id: string; rotation_date_id: string }[];
  tables: { id: string; rotation_date_id: string | null; position: number }[];
  seats: { table_id: string; party_id: string; left_at: string | null }[];
  suppers: {
    id: string;
    table_id: string;
    rotation_date_id: string;
    starts_at: string;
    host_party_id: string | null;
    host_unavailable: boolean;
  }[];
  replies: { supper_id: string; profile_id: string; status: string }[];
  /** What each guest party brings, for the suppers the caller may read. */
  contributions: { supper_id: string; party_id: string; item: string }[];
}

function rotationRows(rows: Tables<"supper_rotations">[]): RotationRow[] {
  return rows.flatMap(({ format, status, ...row }) => {
    if (isSupperFormat(format) && isRotationStatus(status)) return [{ ...row, format, status }];
    logError("Supper club rotation has a format or status the app does not know", undefined, {
      route: "/g/[groupId]/supper-club",
      ids: { rotationId: row.id },
    });
    return [];
  });
}

/** The group's rotations, newest first; a member's read leaves out drafts. */
export async function loadRotations(supabase: Client, groupId: string): Promise<RotationRow[] | null> {
  const rows = readList(
    await supabase.from("supper_rotations").select("*").eq("group_id", groupId).order("created_at", { ascending: false }),
    "Supper club rotations"
  );
  return rows && rotationRows(rows);
}

/** The group's rotation titles, drafts included, leaving out exceptRotationId; null when the read failed. */
export async function loadRotationTitles(
  supabase: Client,
  groupId: string,
  exceptRotationId?: string
): Promise<string[] | null> {
  const query = supabase.from("supper_rotations").select("title").eq("group_id", groupId);
  const rows = readList(
    await (exceptRotationId ? query.neq("id", exceptRotationId) : query),
    "Supper club rotation titles"
  );
  return rows && rows.map((r) => r.title);
}

/** One rotation: `{ rotation: null }` when the caller has no such rotation, null when the read failed. */
export async function loadRotation(
  supabase: Client,
  groupId: string,
  rotationId: string
): Promise<{ rotation: RotationRow | null } | null> {
  const rows = readList(
    await supabase.from("supper_rotations").select("*").eq("group_id", groupId).eq("id", rotationId).limit(1),
    "Supper club rotation"
  );
  return rows && { rotation: rotationRows(rows)[0] ?? null };
}

/** The rotation the Supper club page is about: one taking sign-ups or running, then a leader's draft, then the last ended. */
export function currentRotation(rotations: RotationRow[]): RotationRow | null {
  return (
    rotations.find((s) => s.status === "open" || s.status === "published") ??
    rotations.find((s) => s.status === "draft") ??
    rotations.find((s) => s.status === "ended") ??
    null
  );
}

/** Everything about one rotation the caller may read. Null when a read failed. */
export async function loadRotationData(supabase: Client, rotationId: string): Promise<RotationData | null> {
  const [dates, parties, members, addresses, notes, tables, unavailable, seats, suppers] = await Promise.all([
    supabase.from("supper_rotation_dates").select("id, starts_at").eq("rotation_id", rotationId).order("starts_at"),
    supabase.from("supper_parties").select("*").eq("rotation_id", rotationId).order("created_at"),
    supabase.from("supper_party_members").select("party_id, profile_id").eq("rotation_id", rotationId).order("created_at"),
    supabase
      .from("supper_party_addresses")
      .select("party_id, address_line1, address_line2, city, state, postal_code")
      .eq("rotation_id", rotationId),
    supabase.from("supper_party_notes").select("party_id, food_notes").eq("rotation_id", rotationId),
    supabase.from("supper_tables").select("id, rotation_date_id, position").eq("rotation_id", rotationId).order("position"),
    // Unavailable dates, seats, suppers and replies grow with parties times dates, so they page.
    fetchAll((from, to) =>
      supabase
        .from("supper_party_unavailable_dates")
        .select("party_id, rotation_date_id")
        .eq("rotation_id", rotationId)
        .order("party_id")
        .order("rotation_date_id")
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from("supper_seats")
        .select("table_id, party_id, left_at")
        .eq("rotation_id", rotationId)
        .order("table_id")
        .order("party_id")
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from("suppers")
        .select("id, table_id, rotation_date_id, starts_at, host_party_id, host_unavailable")
        .eq("rotation_id", rotationId)
        .order("starts_at")
        .order("id")
        .range(from, to)
    ),
  ]);
  const read = {
    dates: readList(dates, "Supper club dates"),
    parties: readList(parties, "Supper club parties"),
    members: readList(members, "Supper club party members"),
    addresses: readList(addresses, "Supper club addresses"),
    notes: readList(notes, "Supper club food notes"),
    unavailable: readList(unavailable, "Supper club unavailable dates"),
    tables: readList(tables, "Supper club tables"),
    seats: readList(seats, "Supper club seats"),
    suppers: readList(suppers, "suppers"),
  };
  if (Object.values(read).some((rows) => rows === null)) return null;

  const supperIds = read.suppers!.map((d) => d.id);
  const [replies, contributions] = supperIds.length
    ? await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from("supper_replies")
            .select("supper_id, profile_id, status")
            .in("supper_id", supperIds)
            .order("supper_id")
            .order("profile_id")
            .range(from, to)
        ).then((r) => readList(r, "supper replies")),
        fetchAll((from, to) =>
          supabase
            .from("supper_contributions")
            .select("supper_id, party_id, item")
            .eq("rotation_id", rotationId)
            .order("supper_id")
            .order("party_id")
            .range(from, to)
        ).then((r) => readList(r, "supper contributions")),
      ])
    : [[], []];
  if (replies === null || contributions === null) return null;
  return { ...(read as { [K in keyof typeof read]: NonNullable<(typeof read)[K]> }), replies, contributions };
}

/** The group's approved members, by name. */
export async function loadGroupPeople(supabase: Client, groupId: string): Promise<Person[] | null> {
  const members = readList(
    await supabase.from("group_members").select("profile_id").eq("group_id", groupId),
    "Supper club group members"
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
    "Supper club names"
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

export function peopleOf(data: Pick<RotationData, "members">, partyId: string): string[] {
  return data.members.filter((m) => m.party_id === partyId).map((m) => m.profile_id);
}

export function shuffleParties(data: RotationData): ShuffleParty[] {
  return data.parties
    .filter((p) => p.status !== "withdrawn")
    .map((p) => ({
      id: p.id,
      size: peopleOf(data, p.id).length === 2 ? 2 : 1,
      canHost: p.can_host,
      seats: p.seats,
      preferredDateId: p.preferred_rotation_date_id,
      unavailableDateIds: data.unavailable.filter((u) => u.party_id === p.id).map((u) => u.rotation_date_id),
    }));
}

/**
 * The tables of the two rotations before this one, as each table's parties'
 * people, for the shuffle to keep tablemates apart. A leader reads every
 * rotation of the group; a rotation since deleted ends the chain. Null when a
 * read failed.
 */
export async function loadPastTables(supabase: Client, rotation: RotationRow): Promise<string[][][] | null> {
  const rotationIds: string[] = [];
  let previous = rotation.previous_rotation_id;
  while (previous && rotationIds.length < 2) {
    rotationIds.push(previous);
    const rows = readList(
      await supabase.from("supper_rotations").select("previous_rotation_id").eq("id", previous).limit(1),
      "Supper club earlier rotation"
    );
    if (!rows) return null;
    previous = rows[0]?.previous_rotation_id ?? null;
  }
  if (rotationIds.length === 0) return [];
  const [seats, members] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("supper_seats")
        .select("table_id, party_id")
        .in("rotation_id", rotationIds)
        .order("table_id")
        .order("party_id")
        .range(from, to)
    ).then((r) => readList(r, "Supper club earlier seats")),
    fetchAll((from, to) =>
      supabase
        .from("supper_party_members")
        .select("party_id, profile_id")
        .in("rotation_id", rotationIds)
        .order("party_id")
        .order("profile_id")
        .range(from, to)
    ).then((r) => readList(r, "Supper club earlier party members")),
  ]);
  if (!seats || !members) return null;
  const tables = new Map<string, string[][]>();
  for (const seat of seats) {
    const people = members.filter((m) => m.party_id === seat.party_id).map((m) => m.profile_id);
    tables.set(seat.table_id, [...(tables.get(seat.table_id) ?? []), people]);
  }
  return [...tables.values()];
}

/** A person's own party last rotation, to sign up again from. */
export interface LastRotationSignUp {
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
 * The caller's party in the rotation before, unless it withdrew. Row security
 * gives a member only their own party's rows, so nothing here is anyone
 * else's. Null when there is none or a read failed: the form then starts empty.
 */
export async function loadLastRotationSignUp(
  supabase: Client,
  previousRotationId: string,
  meId: string
): Promise<LastRotationSignUp | null> {
  const mine = readList(
    await supabase
      .from("supper_party_members")
      .select("party_id")
      .eq("rotation_id", previousRotationId)
      .eq("profile_id", meId)
      .limit(1),
    "Supper club last rotation party"
  );
  const partyId = mine?.[0]?.party_id;
  if (!partyId) return null;
  const [party, members, address, notes] = await Promise.all([
    supabase.from("supper_parties").select("*").eq("id", partyId).limit(1),
    supabase.from("supper_party_members").select("profile_id").eq("party_id", partyId),
    supabase
      .from("supper_party_addresses")
      .select("party_id, address_line1, address_line2, city, state, postal_code")
      .eq("party_id", partyId)
      .limit(1),
    supabase.from("supper_party_notes").select("food_notes").eq("party_id", partyId).limit(1),
  ]);
  const read = {
    party: readList(party, "Supper club last rotation party"),
    members: readList(members, "Supper club last rotation party members"),
    address: readList(address, "Supper club last rotation address"),
    notes: readList(notes, "Supper club last rotation food notes"),
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
