// What the profile form shows for a detail that came from the church's
// records. Members never see the product's name, only "your church".
import {
  type Columns,
  FIELD_COLUMNS,
  type FieldMode,
  type RecordsField,
  sameValue,
  type ValueField,
  type ValueState,
} from "@/supabase/functions/_shared/records-copy";
import { HOUSEHOLD_TAB } from "@/lib/profileTabs";

export interface ProfileRecords {
  settings: Partial<Record<RecordsField, FieldMode>>;
  values: Partial<Record<ValueField, { state: ValueState; churchValue: Columns }>>;
  /** The church filled something in and the person hasn't said they've seen it. */
  noticeDue: boolean;
}

export type RecordsLabel =
  | { kind: "locked" }
  | { kind: "records" }
  | { kind: "changed"; churchValue: Columns | null };

const blank = (value: unknown) => value === null || value === undefined || value === "";

/** The label for a field, or null when the value isn't from the church's records. */
export function recordsLabel(records: ProfileRecords | null | undefined, field: ValueField): RecordsLabel | null {
  const value = records?.values[field];
  if (!value) return null;
  if (field !== "preferred_name" && records?.settings[field] === "locked") return { kind: "locked" };
  if (value.state === "records") return { kind: "records" };
  const church = Object.fromEntries(Object.entries(value.churchValue).filter(([key]) => key !== "photo"));
  return { kind: "changed", churchValue: Object.values(church).some((v) => !blank(v)) ? church : null };
}

export function isLocked(records: ProfileRecords | null | undefined, field: ValueField): boolean {
  return recordsLabel(records, field)?.kind === "locked";
}

/** What the church admin's settings and the member's notice call each detail. */
export const FIELD_LABELS: Record<ValueField, string> = {
  name: "Name",
  preferred_name: "Preferred name",
  title: "Title",
  suffix: "Suffix",
  phone_mobile: "Mobile phone",
  phone_work: "Work phone",
  birthday: "Birthday",
  gender: "Gender",
  photo: "Photo",
  anniversary: "Anniversary",
  grade: "A child's grade",
};

/**
 * Where the one-time notice sends a member to change or clear each detail.
 * The anniversary is the household's and is edited on the Household tab. A
 * linked person's grade is on no form a member can edit, so it has no link.
 */
export const NOTICE_FIELDS: Record<ValueField, { href: string; household?: true } | null> = {
  name: { href: "#first_name" },
  preferred_name: { href: "#preferred_name" },
  title: { href: "#title" },
  suffix: { href: "#suffix" },
  phone_mobile: { href: "#phone_mobile" },
  phone_work: { href: "#phone_work" },
  birthday: { href: "#birth_month" },
  gender: { href: "#gender-label" },
  photo: { href: "#profile-photo" },
  anniversary: { href: `?tab=${HOUSEHOLD_TAB}#anniversary_month`, household: true },
  grade: null,
};

/** The filled details the member may change, for the one-time notice; the anniversary only for someone in a household. */
export function changeableFilled(
  records: ProfileRecords | null | undefined,
  { household }: { household: boolean },
): { field: ValueField; label: string; href: string }[] {
  return (Object.entries(NOTICE_FIELDS) as [ValueField, (typeof NOTICE_FIELDS)[ValueField]][]).flatMap(
    ([field, link]) =>
      link && (household || !link.household) && recordsLabel(records, field)?.kind === "records"
        ? [{ field, label: FIELD_LABELS[field], href: link.href }]
        : [],
  );
}

type Source = { state: ValueState; churchValue: Columns };

/**
 * The household's anniversary source, from its linked people's. The copy
 * keeps them alike; should they still differ, the household shows no source
 * rather than one person's.
 */
export function agreedAnniversary(sources: readonly Source[]): Source | null {
  const [first, ...rest] = sources;
  if (!first) return null;
  const agree = rest.every(
    (s) => s.state === first.state && sameValue(s.churchValue, first.churchValue, FIELD_COLUMNS.anniversary),
  );
  return agree ? first : null;
}
