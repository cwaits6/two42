import {
  type FieldMode,
  LOCKABLE_FIELDS,
  RECORDS_FIELDS,
  type RecordsField,
} from "@/supabase/functions/_shared/records-copy";

/** The church's setting for each field it fills from its records; a field left out is not from them. */
export type FieldSettings = Partial<Record<RecordsField, FieldMode>>;

/** The settings in a request body, or null when any field or setting isn't one two42 allows. */
export function parseFieldSettings(value: unknown): FieldSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings: FieldSettings = {};
  for (const [field, mode] of Object.entries(value)) {
    if (!(RECORDS_FIELDS as readonly string[]).includes(field)) return null;
    const known = field as RecordsField;
    if (mode === "member") settings[known] = "member";
    else if (mode === "locked" && LOCKABLE_FIELDS.includes(known)) settings[known] = "locked";
    else return null;
  }
  return settings;
}
