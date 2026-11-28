// Which details the directory shows live from the church's records, worked
// out without any I/O. The people and households come from the viewer's own
// RLS-scoped directory read, so the provider is asked about exactly the people
// the viewer may already see and no one else. Values pass through here on the
// way to the viewer and are never stored, logged or put in an error.
import {
  anniversaryColumns,
  formDate,
  formGraduationYear,
  householdChurchAnniversary,
  isEmptyValue,
  pick,
  type Columns,
  type ValueState,
} from "@/supabase/functions/_shared/records-copy";
import { ADDRESS_COLUMNS, householdChurchValues } from "@/supabase/functions/_shared/records-households";
import type { DirectoryProfile, FamilyDirectoryFull, HouseholdFamilyMember } from "@/lib/types";
import type { RecordsLiveDetails } from "./types";

/** "shown": the records' value. "empty": the records have none. "hidden": the viewer hid it and may show it again. */
export type LiveSlot<T> =
  | { state: "shown"; value: T }
  | { state: "empty" }
  | { state: "unavailable" }
  | { state: "hidden" };

export interface LiveDate {
  month: number;
  day: number;
}

export interface LiveAnniversary extends LiveDate {
  year: number | null;
}

type AddressColumns = Record<(typeof ADDRESS_COLUMNS)[number], string | null>;

export type LiveAddress = AddressColumns & { address_line1: string };

export interface LivePersonSlots {
  birthday?: LiveSlot<LiveDate>;
}

export interface LiveHouseholdSlots {
  address?: LiveSlot<LiveAddress>;
  anniversary?: LiveSlot<LiveAnniversary>;
}

export interface LiveChildSlots {
  birthday?: LiveSlot<LiveDate>;
  grade?: LiveSlot<number>;
}

export interface LiveDirectoryOn {
  mode: "live";
  /** Nothing could be read, from the records or from two42, so no detail is known to be live or not; every slot is then empty. */
  unavailable: boolean;
  /** By profile id. */
  people: Record<string, LivePersonSlots>;
  /** By household id. */
  households: Record<string, LiveHouseholdSlots>;
  /** By household member id, for children added from the records' suggestions. */
  children: Record<string, LiveChildSlots>;
  /** Whose details the viewer may hide: their own birthday, and their household's when they are its primary or spouse. */
  canHide: { person: string | null; household: string | null };
}

/** "off": the church shows nothing live, and the directory is exactly as without church records. */
export type LiveDirectory = { mode: "off" } | LiveDirectoryOn;

/** A church that shows details live, when nothing about them could be read. */
export const LIVE_UNAVAILABLE: LiveDirectoryOn = {
  mode: "live",
  unavailable: true,
  people: {},
  households: {},
  children: {},
  canHide: { person: null, household: null },
};

export type VisiblePerson = Pick<DirectoryProfile, "id" | "family_id" | "relationship" | "birth_month" | "birth_day">;

export type VisibleHousehold = Pick<
  FamilyDirectoryFull,
  "id" | (typeof ADDRESS_COLUMNS)[number] | "anniversary_month" | "anniversary_day"
> & {
  family_members_list: Pick<
    HouseholdFamilyMember,
    "id" | "claimed_profile_id" | "birth_month" | "birth_day" | "graduation_year"
  >[];
};

/** What two42 holds about these visible people's links and sources; never a value from the records. */
export interface LiveSources {
  /** The fields the church fills from its records. */
  fields: ReadonlySet<string>;
  /** External person id by profile id. */
  personLinks: ReadonlyMap<string, string>;
  /** External family id by household id. */
  householdLinks: ReadonlyMap<string, string>;
  /** By `${profileId}:${field}`, for the birthday. */
  personStates: ReadonlyMap<string, ValueState>;
  /** The anniversary's source, by household id. */
  anniversaryStates: ReadonlyMap<string, ValueState>;
  /** The address's source, by household id. */
  addressStates: ReadonlyMap<string, ValueState>;
  /** External person id by household member id, for children added from a suggestion while children are suggested. */
  children: ReadonlyMap<string, string>;
}

type Planned =
  | { kind: "person"; id: string; field: "birthday"; from: string }
  | { kind: "household"; id: string; field: "anniversary"; from: string[] }
  | { kind: "household"; id: string; field: "address"; from: string }
  | { kind: "child"; id: string; field: "birthday" | "grade"; from: string };

/** The live details a member may hide from the directory; records_live_hide() accepts these. */
export const HIDEABLE_FIELDS = ["birthday", "anniversary", "address"] as const;
export type HideableField = (typeof HIDEABLE_FIELDS)[number];

type HiddenSlot = { kind: "person" | "household"; id: string; field: HideableField };

export interface LivePlan {
  /** External person ids to ask for: only visible, linked people and visible children. */
  people: string[];
  /** External family ids to ask for: only visible, linked households. */
  families: string[];
  planned: Planned[];
  hidden: HiddenSlot[];
  canHide: LiveDirectoryOn["canHide"];
}

const filled = (month: number | null, day: number | null) => !!month && !!day;

/**
 * Each live detail's source, by the copy rules applied as it is read: a value
 * the member entered in two42 or changed is theirs, one they cleared stays
 * hidden, and only an empty one with no source of its own is the records'.
 */
export function planLiveRequest(input: {
  viewer: { id: string; family_id: string | null; relationship: string | null };
  people: readonly VisiblePerson[];
  households: readonly VisibleHousehold[];
  sources: LiveSources;
}): LivePlan {
  const { viewer, sources } = input;
  const manages = viewer.family_id && (viewer.relationship === "primary" || viewer.relationship === "spouse");
  const canHide = { person: viewer.id, household: manages ? viewer.family_id : null };
  const planned: Planned[] = [];
  const hidden: HiddenSlot[] = [];
  const hide = (slot: HiddenSlot) => {
    if (slot.kind === "person" ? slot.id === canHide.person : slot.id === canHide.household) hidden.push(slot);
  };

  if (sources.fields.has("birthday")) {
    for (const person of input.people) {
      const from = sources.personLinks.get(person.id);
      if (!from) continue;
      const state = sources.personStates.get(`${person.id}:birthday`);
      if (state === "cleared") hide({ kind: "person", id: person.id, field: "birthday" });
      else if (state !== "changed" && !filled(person.birth_month, person.birth_day)) {
        planned.push({ kind: "person", id: person.id, field: "birthday", from });
      }
    }
  }

  for (const household of input.households) {
    if (sources.fields.has("anniversary")) {
      const couple = input.people
        .filter((p) => p.family_id === household.id && sources.personLinks.has(p.id))
        .filter((p) => p.relationship === "primary" || p.relationship === "spouse")
        .sort((a, b) => Number(b.relationship === "primary") - Number(a.relationship === "primary"));
      const state = sources.anniversaryStates.get(household.id);
      if (couple.length > 0 && state !== "changed") {
        if (state === "cleared") hide({ kind: "household", id: household.id, field: "anniversary" });
        else if (!filled(household.anniversary_month, household.anniversary_day)) {
          // Every spouse's records are read, so a household is shown an anniversary only while they agree, as the copy does.
          const from = couple.map((p) => sources.personLinks.get(p.id)!);
          planned.push({ kind: "household", id: household.id, field: "anniversary", from });
        }
      }
    }

    const family = sources.householdLinks.get(household.id);
    if (sources.fields.has("address") && family) {
      const own: AddressColumns = household;
      const state = sources.addressStates.get(household.id);
      if (state === "cleared") hide({ kind: "household", id: household.id, field: "address" });
      else if (state !== "changed" && isEmptyValue(pick(own, ADDRESS_COLUMNS))) {
        planned.push({ kind: "household", id: household.id, field: "address", from: family });
      }
    }

    for (const member of household.family_members_list) {
      const from = member.claimed_profile_id ? undefined : sources.children.get(member.id);
      if (!from) continue;
      if (!filled(member.birth_month, member.birth_day)) planned.push({ kind: "child", id: member.id, field: "birthday", from });
      if (member.graduation_year === null) planned.push({ kind: "child", id: member.id, field: "grade", from });
    }
  }

  const unique = (ids: string[]) => [...new Set(ids)].sort();
  return {
    people: unique(planned.filter((p) => !(p.kind === "household" && p.field === "address")).flatMap((p) => p.from)),
    families: unique(planned.flatMap((p) => (p.kind === "household" && p.field === "address" ? [p.from] : []))),
    planned,
    hidden,
    canHide,
  };
}

function liveAddress(columns: Columns): LiveAddress | null {
  const text = (c: (typeof ADDRESS_COLUMNS)[number]) => {
    const v = columns[c];
    return typeof v === "string" && v ? v : null;
  };
  const line1 = text("address_line1");
  return line1
    ? { address_line1: line1, address_line2: text("address_line2"), city: text("city"), state: text("state"), postal_code: text("postal_code") }
    : null;
}

const date = (d: { month: number | null; day: number | null }): LiveSlot<LiveDate> => {
  const { month, day } = formDate({ ...d, year: null });
  return month && day ? { state: "shown", value: { month, day } } : { state: "empty" };
};

/**
 * The response for a plan: the records' values normalized exactly as the
 * copy would store them, so live and copied details read the same. Every
 * planned slot whose half of the details couldn't be read is unavailable.
 */
export function liveDirectory(plan: LivePlan, details: RecordsLiveDetails | null, today: Date): LiveDirectoryOn {
  const result: LiveDirectoryOn = { mode: "live", unavailable: false, people: {}, households: {}, children: {}, canHide: plan.canHide };
  const slots = (kind: Planned["kind"] | HiddenSlot["kind"], id: string): Record<string, unknown> => {
    const bucket = kind === "person" ? result.people : kind === "household" ? result.households : result.children;
    return ((bucket as Record<string, Record<string, unknown>>)[id] ??= {});
  };
  for (const slot of plan.hidden) slots(slot.kind, slot.id)[slot.field] = { state: "hidden" };
  for (const slot of plan.planned) {
    const target = slots(slot.kind, slot.id);
    const isAddress = slot.kind === "household" && slot.field === "address";
    const read = isAddress ? details?.families : details?.people;
    if (!read) {
      target[slot.field] = { state: "unavailable" };
      continue;
    }
    if (slot.field === "address") {
      const address = details?.families?.get(slot.from);
      const value = address ? liveAddress(householdChurchValues({ address, homePhone: null }, () => null).address) : null;
      target.address = value ? { state: "shown", value } : { state: "empty" };
      continue;
    }
    if (slot.field === "anniversary") {
      // Someone the records didn't return holds no anniversary; spouses whose records differ show none.
      const dates = slot.from.flatMap((id) => {
        const spouse = details?.people?.get(id);
        return spouse ? [formDate(spouse.anniversary, today)] : [];
      });
      const agreed = householdChurchAnniversary(dates.map((d) => anniversaryColumns(d, today)));
      const shown = agreed && dates.find((d) => d.month && d.day);
      target.anniversary = shown?.month && shown.day
        ? { state: "shown", value: { month: shown.month, day: shown.day, year: shown.year } }
        : { state: "empty" };
      continue;
    }
    const person = details?.people?.get(slot.from);
    if (!person) {
      target[slot.field] = { state: "empty" };
    } else if (slot.field === "grade") {
      const grade = formGraduationYear(person.graduationYear);
      target.grade = grade === null ? { state: "empty" } : { state: "shown", value: grade };
    } else {
      target.birthday = date(person.birthday);
    }
  }
  return result;
}
