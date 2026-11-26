// What the profile form shows for a detail that came from the church's
// records. Members never see the product's name, only "your church".
import type { Columns, FieldMode, RecordsField, ValueField, ValueState } from "@/supabase/functions/_shared/records-copy";

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

/** The form fields a member may change that the church filled in, for the one-time notice. */
export const NOTICE_FIELDS: { field: ValueField; label: string; anchor: string }[] = [
  { field: "name", label: "Name", anchor: "first_name" },
  { field: "preferred_name", label: "Preferred name", anchor: "preferred_name" },
  { field: "title", label: "Title", anchor: "title" },
  { field: "suffix", label: "Suffix", anchor: "suffix" },
  { field: "phone_mobile", label: "Mobile phone", anchor: "phone_mobile" },
  { field: "phone_work", label: "Work phone", anchor: "phone_work" },
  { field: "birthday", label: "Birthday", anchor: "birth_month" },
  { field: "gender", label: "Gender", anchor: "gender-label" },
  { field: "photo", label: "Photo", anchor: "profile-photo" },
];

export function changeableFilled(records: ProfileRecords | null | undefined) {
  return NOTICE_FIELDS.filter(({ field }) => recordsLabel(records, field)?.kind === "records");
}
