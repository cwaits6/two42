// Which details the directory shows live from the church's records, worked
// out without any I/O. The people and households come from the viewer's own
// RLS-scoped directory read, so the provider is asked about exactly the people
// the viewer may already see and no one else. Values pass through here on the
// way to the viewer and are never stored, logged or put in an error.
import { formDate, formGraduationYear, type ValueState } from "@/supabase/functions/_shared/records-copy";
import { householdChurchValues } from "@/supabase/functions/_shared/records-households";
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

export interface LiveAddress {
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

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

export interface VisiblePerson {
  id: string;
  family_id: string | null;
  relationship: string | null;
  birth_month: number | null;
  birth_day: number | null;
}

export interface VisibleHousehold {
  id: string;
  address_line1: string | null;
  city: string | null;
  anniversary_month: number | null;
  anniversary_day: number | null;
  family_members_list: {
    id: string;
    claimed_profile_id: string | null;
    birth_month: number | null;
    birth_day: number | null;
    graduation_year: number | null;
  }[];
}

/** What two42 holds about these visible people's links and sources; never a value from the records. */
export interface LiveSources {
  /** The fields the church fills from its records. */
  fields: ReadonlySet<string>;
  /** External person id by profile id. */
  personLinks: ReadonlyMap<string, string>;
  /** External family id by household id. */
  householdLinks: ReadonlyMap<string, string>;
  /** By `${profileId}:${field}`, for birthday and anniversary. */
  personStates: ReadonlyMap<string, ValueState>;
  /** The address's source, by household id. */
  addressStates: ReadonlyMap<string, ValueState>;
  /** External person id by household member id, for children added from a suggestion while children are suggested. */
  children: ReadonlyMap<string, string>;
}

type Planned =
  | { kind: "person"; id: string; field: "birthday"; from: string }
  | { kind: "household"; id: string; field: "anniversary"; from: string }
  | { kind: "household"; id: string; field: "address"; from: string }
  | { kind: "child"; id: string; field: "birthday" | "grade"; from: string };

type HiddenSlot = { kind: "person" | "household"; id: string; field: "birthday" | "anniversary" | "address" };

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
      const states = couple.map((p) => sources.personStates.get(`${p.id}:anniversary`));
      if (couple.length > 0 && !states.includes("changed")) {
        if (states.includes("cleared")) hide({ kind: "household", id: household.id, field: "anniversary" });
        else if (!filled(household.anniversary_month, household.anniversary_day)) {
          planned.push({ kind: "household", id: household.id, field: "anniversary", from: sources.personLinks.get(couple[0].id)! });
        }
      }
    }

    const family = sources.householdLinks.get(household.id);
    if (sources.fields.has("address") && family) {
      const state = sources.addressStates.get(household.id);
      if (state === "cleared") hide({ kind: "household", id: household.id, field: "address" });
      else if (state !== "changed" && !household.address_line1 && !household.city) {
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
    people: unique(planned.filter((p) => !(p.kind === "household" && p.field === "address")).map((p) => p.from)),
    families: unique(planned.filter((p) => p.kind === "household" && p.field === "address").map((p) => p.from)),
    planned,
    hidden,
    canHide,
  };
}

const date = (d: { month: number | null; day: number | null }): LiveSlot<LiveDate> => {
  const { month, day } = formDate({ ...d, year: null });
  return month && day ? { state: "shown", value: { month, day } } : { state: "empty" };
};

/**
 * The response for a plan: the records' values normalized exactly as the
 * copy would store them, so live and copied details read the same. With no
 * details, because the records couldn't be reached, every planned slot is
 * unavailable.
 */
export function liveDirectory(plan: LivePlan, details: RecordsLiveDetails | null, today: Date): LiveDirectoryOn {
  const result: LiveDirectoryOn = { mode: "live", people: {}, households: {}, children: {}, canHide: plan.canHide };
  const slots = (kind: Planned["kind"] | HiddenSlot["kind"], id: string): Record<string, unknown> => {
    const bucket = kind === "person" ? result.people : kind === "household" ? result.households : result.children;
    return ((bucket as Record<string, Record<string, unknown>>)[id] ??= {});
  };
  for (const slot of plan.hidden) slots(slot.kind, slot.id)[slot.field] = { state: "hidden" };
  for (const slot of plan.planned) {
    const target = slots(slot.kind, slot.id);
    if (!details) {
      target[slot.field] = { state: "unavailable" };
      continue;
    }
    if (slot.kind === "household" && slot.field === "address") {
      const address = details.families.get(slot.from);
      const value = address ? householdChurchValues({ address, homePhone: null }, () => null).address : null;
      target.address = value?.address_line1
        ? { state: "shown", value: value as unknown as LiveAddress }
        : { state: "empty" };
      continue;
    }
    const person = details.people.get(slot.from);
    if (!person) {
      target[slot.field] = { state: "empty" };
    } else if (slot.field === "anniversary") {
      const { month, day, year } = formDate(person.anniversary, today);
      target.anniversary = month && day ? { state: "shown", value: { month, day, year } } : { state: "empty" };
    } else if (slot.field === "grade") {
      const grade = formGraduationYear(person.graduationYear);
      target.grade = grade === null ? { state: "empty" } : { state: "shown", value: grade };
    } else {
      target.birthday = date(person.birthday);
    }
  }
  return result;
}
