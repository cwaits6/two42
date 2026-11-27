import {
  type FieldMode,
  LOCKABLE_FIELDS,
  RECORDS_FIELDS,
  type RecordsField,
} from "@/supabase/functions/_shared/records-copy";
import { HOUSEHOLD_FIELDS, type HouseholdField } from "@/supabase/functions/_shared/records-households";

/** The church's setting for each field it fills from its records; a field left out is not from them. */
export type FieldSettings = Partial<Record<RecordsField, FieldMode> & Record<HouseholdField, "member">>;

const FIELDS: readonly string[] = [...RECORDS_FIELDS, ...HOUSEHOLD_FIELDS];

/** The settings in a request body, or null when any field or setting isn't one two42 allows. */
export function parseFieldSettings(value: unknown): FieldSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const settings: Record<string, FieldMode> = {};
  for (const [field, mode] of Object.entries(value)) {
    if (!FIELDS.includes(field)) return null;
    if (mode === "member") settings[field] = "member";
    else if (mode === "locked" && (LOCKABLE_FIELDS as readonly string[]).includes(field)) settings[field] = "locked";
    else return null;
  }
  return settings as FieldSettings;
}
