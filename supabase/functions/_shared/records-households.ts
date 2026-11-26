// What the church's families mean for two42's households, worked out without
// any I/O so the app's Refresh now and the nightly run apply the same rules.
// Nothing here changes a household: a grouping is a suggestion the church
// admin confirms, a child is a suggestion a household's adults add, and only
// a household already linked to its family gets the family's address and home
// phone, under the field settings and the member-edit trigger in
// 20261210000000_church_records_households.sql.
import { normalizePostalCode, normalizeState, titleCaseCity, titleCaseStreet } from "./address-case.ts";
import { MAX_NAME_LENGTH, normalizeName, titleCaseName } from "./name-case.ts";
import { type Columns, isEmptyValue, sameValue, type ValueState } from "./records-copy.ts";
import type { RecordsChild, RecordsFamily } from "./records-types.ts";
import type { Relationship } from "./relationships.ts";

/** The household fields a church admin chooses a setting for; always the members' to change. */
export const HOUSEHOLD_FIELDS = ["address", "phone_home"] as const;
export type HouseholdField = (typeof HOUSEHOLD_FIELDS)[number];

const ADDRESS_COLUMNS = ["address_line1", "address_line2", "city", "state", "postal_code"] as const;

export const HOUSEHOLD_FIELD_COLUMNS: Record<HouseholdField, readonly string[]> = {
  address: ADDRESS_COLUMNS,
  phone_home: ["phone_home"],
};

/** The household columns a copy reads: the fields' own, and the spouse's phone choice that replaces phone_home. */
export const HOUSEHOLD_COPY_COLUMNS = [...ADDRESS_COLUMNS, "phone_home", "phone_profile_id"] as const;


const blank = (value: unknown) => value === null || value === undefined || value === "";
const isUs = (country: string) => !country || ["us", "usa"].includes(country.trim().toLowerCase());

/**
 * The family's address and home phone, normalized exactly as the household
 * form saves them. A value the form wouldn't accept, or an address outside the
 * US the form can't hold, counts as empty.
 */
export function householdChurchValues(
  family: Pick<RecordsFamily, "address" | "homePhone">,
  normalizePhone: (raw: string) => string | null,
): Record<HouseholdField, Columns> {
  const emptyAddress = Object.fromEntries(HOUSEHOLD_FIELD_COLUMNS.address.map((c) => [c, null]));
  const a = family.address;
  let address: Columns = emptyAddress;
  if (a && isUs(a.country)) {
    const line1 = titleCaseStreet(a.street1);
    const state = a.state ? normalizeState(a.state) : null;
    const postal = a.postalCode ? normalizePostalCode(a.postalCode) : null;
    if (line1 && (!a.state || state) && (!a.postalCode || postal)) {
      address = {
        address_line1: line1,
        address_line2: titleCaseStreet(a.street2),
        city: titleCaseCity(a.city),
        state,
        postal_code: postal,
      };
    }
  }
  const phone = family.homePhone;
  return {
    address,
    phone_home: { phone_home: phone ? normalizePhone(`+${phone.countryCode || "1"}${phone.number}`) : null },
  };
}

export interface HouseholdStoredValue {
  state: ValueState;
  churchValue: Columns;
}

export interface HouseholdValueRow {
  field: HouseholdField;
  state: ValueState;
  church_value: Columns;
}

export interface HouseholdCopyPlan {
  /** The household columns to write. */
  household: Columns;
  values: HouseholdValueRow[];
}

const pick = (row: Columns, columns: readonly string[]): Columns =>
  Object.fromEntries(columns.map((c) => [c, blank(row[c]) ? null : row[c]]));

/**
 * The household's copy, by the member-changeable rules people's details follow:
 * a first fill never replaces what a member entered, a value still the
 * church's follows the records, and a member's change or clear stays theirs.
 * While a spouse's own number is the household phone, the phone is theirs.
 */
export function planHouseholdCopy(input: {
  fields: ReadonlySet<HouseholdField>;
  current: Columns;
  stored: ReadonlyMap<HouseholdField, HouseholdStoredValue>;
  family: Pick<RecordsFamily, "address" | "homePhone">;
  normalizePhone: (raw: string) => string | null;
}): HouseholdCopyPlan {
  const plan: HouseholdCopyPlan = { household: {}, values: [] };
  const church = householdChurchValues(input.family, input.normalizePhone);
  for (const field of HOUSEHOLD_FIELDS) {
    if (!input.fields.has(field)) continue;
    const columns = HOUSEHOLD_FIELD_COLUMNS[field];
    const value = church[field];
    const prior = input.stored.get(field);
    const record = (state: ValueState) => plan.values.push({ field, state, church_value: value });
    if (field === "phone_home" && !blank(input.current.phone_profile_id)) {
      if (prior) record(prior.state === "records" ? "changed" : prior.state);
      else if (!isEmptyValue(value)) record("changed");
      continue;
    }
    const now = pick(input.current, columns);
    const equal = sameValue(now, value, columns);
    if (!prior) {
      if (isEmptyValue(value)) continue;
      if (equal) record("records");
      else if (isEmptyValue(now)) {
        Object.assign(plan.household, value);
        record("records");
      } else record("changed");
      continue;
    }
    if (prior.state === "records") {
      if (!equal) Object.assign(plan.household, value);
      record("records");
    } else {
      record(prior.state);
    }
  }
  return plan;
}

/** Whether the plan writes the household or a source that differs from what is stored. */
export function householdPlanChanges(plan: HouseholdCopyPlan, stored: ReadonlyMap<HouseholdField, HouseholdStoredValue>) {
  if (Object.keys(plan.household).length > 0) return true;
  if (plan.values.length !== stored.size) return true;
  return plan.values.some((row) => {
    const prior = stored.get(row.field);
    return !prior || prior.state !== row.state ||
      !sameValue(prior.churchValue, row.church_value, HOUSEHOLD_FIELD_COLUMNS[row.field]);
  });
}

export interface PlanProfile {
  id: string;
  family_id: string | null;
  relationship: Relationship;
  role: string;
  first_name: string | null;
  last_name: string | null;
}

export interface PlanHousehold {
  id: string;
  created_at: string;
}

export interface SuggestedPerson {
  profile_id: string;
  /** The household they were in when the suggestion was worked out, null for none. */
  from_family_id: string | null;
  relationship: Relationship;
}

/** What records_confirm_household() answers; its SQL body returns exactly these. */
export const CONFIRM_HOUSEHOLD_OUTCOMES = ["confirmed", "stale", "gone", "busy"] as const;
export type ConfirmHouseholdOutcome = (typeof CONFIRM_HOUSEHOLD_OUTCOMES)[number];

/** What records_save_field_settings() and records_save_children_setting() answer; their SQL bodies return exactly these. */
export const SAVE_SETTING_OUTCOMES = ["saved", "busy"] as const;
export type SaveSettingOutcome = (typeof SAVE_SETTING_OUTCOMES)[number];

export interface HouseholdSuggestion {
  external_family_id: string;
  /** The household to put them in, or null for a new one named family_name. */
  target_family_id: string | null;
  family_name: string | null;
  /** Everyone whose household or relationship changes; empty when confirming only links the household. */
  people: SuggestedPerson[];
  /** Nobody leaves a household they're in, so it can be confirmed with others. */
  ready: boolean;
}

export interface SuggestionInput {
  families: readonly RecordsFamily[];
  /** Each linked person's own family in the records; someone in more than one family counts in this one only. */
  familyOf: ReadonlyMap<string, string>;
  /** Linked people: the provider's person id to the profile it's linked to. */
  links: ReadonlyMap<string, string>;
  /** Linked people, and everyone in the households they're in. */
  profiles: ReadonlyMap<string, PlanProfile>;
  households: ReadonlyMap<string, PlanHousehold>;
  /** Households already linked to a family in the records, by household id. */
  householdLinks: ReadonlyMap<string, string>;
}

const byName = (a: PlanProfile, b: PlanProfile) =>
  normalizeName(a.last_name).localeCompare(normalizeName(b.last_name)) ||
  normalizeName(a.first_name).localeCompare(normalizeName(b.first_name)) ||
  a.id.localeCompare(b.id);

/**
 * One suggestion per family whose linked people aren't yet one household
 * linked to it. A family's household is the one already linked to it, else
 * the one holding most of its people that isn't linked to another family, else
 * a new one. Only the people named move; whoever stays behind, and every
 * child without an account, stays where they are.
 */
export function planHouseholdSuggestions(input: SuggestionInput): HouseholdSuggestion[] {
  const linkedTo = new Map<string, string>();
  for (const [household, family] of input.householdLinks) linkedTo.set(family, household);
  const membersOf = (household: string) => [...input.profiles.values()].filter((p) => p.family_id === household);

  const planned = input.families.map((family) => {
    const linked = family.members.flatMap((member) => {
      const profileId = input.links.get(member.id);
      const profile = profileId ? input.profiles.get(profileId) : undefined;
      const approved = profile && (profile.role === "member" || profile.role === "admin");
      return approved && input.familyOf.get(member.id) === family.id ? [{ member, profile }] : [];
    });
    return { family, linked };
  });
  planned.sort((a, b) => b.linked.length - a.linked.length || a.family.id.localeCompare(b.family.id));

  const taken = new Set<string>();
  const suggestions: HouseholdSuggestion[] = [];
  for (const { family, linked } of planned) {
    if (linked.length === 0) continue;
    let target = linkedTo.get(family.id) ?? null;
    if (target === null) {
      const counts = new Map<string, number>();
      for (const { profile } of linked) {
        const h = profile.family_id;
        if (h && input.households.has(h) && !input.householdLinks.has(h) && !taken.has(h)) {
          counts.set(h, (counts.get(h) ?? 0) + 1);
        }
      }
      target = [...counts.keys()].sort((a, b) =>
        (counts.get(b)! - counts.get(a)!) ||
        input.households.get(a)!.created_at.localeCompare(input.households.get(b)!.created_at) ||
        a.localeCompare(b)
      )[0] ?? null;
    }
    if (target) taken.add(target);

    const moving = new Set(linked.map(({ profile }) => profile.id));
    const staying = target ? membersOf(target).filter((p) => !moving.has(p.id)) : [];
    const roles = new Map<string, Relationship>();
    const slots = new Set(staying.map((p) => p.relationship).filter((r) => r === "primary" || r === "spouse"));
    const inTarget = (p: PlanProfile) => target !== null && p.family_id === target;

    // A couple only when they are the family's two adults and both are married in the records.
    const adults = family.members.filter((m) => m.adult);
    const pair = adults.length === 2 && adults.every((m) => m.married)
      ? linked.filter(({ member }) => member.adult).map(({ profile }) => profile)
      : [];
    if (pair.length === 2 && !slots.has("primary") && !slots.has("spouse")) {
      const [first] = [...pair].sort((a, b) =>
        Number(b.relationship === "primary" && inTarget(b)) - Number(a.relationship === "primary" && inTarget(a)) ||
        Number(inTarget(b)) - Number(inTarget(a)) ||
        byName(a, b)
      );
      roles.set(first.id, "primary");
      roles.set(pair.find((p) => p !== first)!.id, "spouse");
      slots.add("primary");
      slots.add("spouse");
    }
    for (const { member, profile } of linked) {
      if (!member.adult) roles.set(profile.id, "child");
    }
    const rest = linked.map(({ profile }) => profile).filter((p) => !roles.has(p.id)).sort(byName);
    if (target === null && !slots.has("primary") && rest.length > 0) {
      roles.set(rest[0].id, "primary");
      slots.add("primary");
    }
    // Someone staying in the household keeps a primary or spouse place before anyone moving in takes it.
    for (const profile of [...rest.filter(inTarget), ...rest.filter((p) => !inTarget(p))]) {
      if (roles.has(profile.id)) continue;
      const r = profile.relationship;
      if (r === "primary" || r === "spouse") {
        if (slots.has(r)) roles.set(profile.id, "other");
        else {
          roles.set(profile.id, r);
          slots.add(r);
        }
      } else roles.set(profile.id, r);
    }

    const people = linked
      .map(({ profile }) => profile)
      .sort(byName)
      .filter((p) => target === null || p.family_id !== target || roles.get(p.id) !== p.relationship)
      .map((p) => ({ profile_id: p.id, from_family_id: p.family_id, relationship: roles.get(p.id)! }));
    if (people.length === 0 && target !== null && linkedTo.get(family.id) === target) continue;

    let familyName: string | null = null;
    if (target === null) {
      const counts = new Map<string, number>();
      const sorted = linked.map(({ profile }) => profile).sort(byName);
      for (const p of sorted) {
        const last = titleCaseName(p.last_name);
        if (last) counts.set(last, (counts.get(last) ?? 0) + 1);
      }
      const best = Math.max(0, ...counts.values());
      familyName = sorted.map((p) => titleCaseName(p.last_name)).find((last) => last && counts.get(last) === best) ?? null;
      // A household needs a name, and two42 names it only from its own data.
      if (!familyName) continue;
    }
    suggestions.push({
      external_family_id: family.id,
      target_family_id: target,
      family_name: familyName,
      people,
      ready: people.every((p) => p.from_family_id === null || p.from_family_id === target),
    });
  }
  return suggestions;
}

export interface ChildRow {
  external_person_id: string;
  first_name: string;
  last_name: string;
  birth_month: number | null;
  birth_day: number | null;
  graduation_year: number | null;
  photo: string | null;
}

/**
 * The family's children to suggest to its household: not someone with their
 * own account, and not a child already in the household under the same name.
 */
export function childSuggestionRows(
  children: readonly RecordsChild[],
  exclude: { linked: ReadonlySet<string>; entries: readonly { first_name: string | null; last_name: string | null }[] },
): ChildRow[] {
  const known = new Set(exclude.entries.map((e) => `${normalizeName(e.first_name)} ${normalizeName(e.last_name)}`));
  return children.flatMap((child) => {
    if (exclude.linked.has(child.id)) return [];
    const first = titleCaseName(child.firstName);
    const last = titleCaseName(child.lastName);
    if (!first || !last || first.length > MAX_NAME_LENGTH || last.length > MAX_NAME_LENGTH) return [];
    if (known.has(`${normalizeName(first)} ${normalizeName(last)}`)) return [];
    const { month, day } = child.birthday;
    const dateOk = !!month && !!day && month >= 1 && month <= 12 && day >= 1 && day <= new Date(2000, month, 0).getDate();
    const grade = child.graduationYear;
    return [{
      external_person_id: child.id,
      first_name: first,
      last_name: last,
      birth_month: dateOk ? month : null,
      birth_day: dateOk ? day : null,
      graduation_year: grade !== null && grade >= 2000 && grade <= 2100 ? grade : null,
      photo: child.photo && child.photo.length <= 100 ? child.photo : null,
    }];
  });
}
