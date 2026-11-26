// What the profile form shows for a detail that came from the church's
// records. Members never see the product's name, only "your church".
import type { Columns, FieldMode, RecordsField, ValueField, ValueState } from "@/supabase/functions/_shared/records-copy";
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

/**
 * Where the one-time notice sends a member to change or clear each detail.
 * The anniversary is the household's and is edited on the Household tab. A
 * linked person's grade is on no form a member can edit, so it has no link.
 */
export const NOTICE_FIELDS: Record<ValueField, { label: string; href: string; household?: true } | null> = {
  name: { label: "Name", href: "#first_name" },
  preferred_name: { label: "Preferred name", href: "#preferred_name" },
  title: { label: "Title", href: "#title" },
  suffix: { label: "Suffix", href: "#suffix" },
  phone_mobile: { label: "Mobile phone", href: "#phone_mobile" },
  phone_work: { label: "Work phone", href: "#phone_work" },
  birthday: { label: "Birthday", href: "#birth_month" },
  gender: { label: "Gender", href: "#gender-label" },
  photo: { label: "Photo", href: "#profile-photo" },
  anniversary: { label: "Anniversary", href: `?tab=${HOUSEHOLD_TAB}#anniversary_month`, household: true },
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
        ? [{ field, label: link.label, href: link.href }]
        : [],
  );
}
