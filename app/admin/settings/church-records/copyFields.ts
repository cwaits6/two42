import {
  type FieldMode,
  LOCKABLE_FIELDS,
  RECORDS_FIELDS,
  type RecordsField,
} from "@/supabase/functions/_shared/records-copy";
import { HOUSEHOLD_FIELDS, type HouseholdField } from "@/supabase/functions/_shared/records-households";
import type { RefreshResult } from "@/supabase/functions/_shared/records-refresh";

export type FieldChoice = "off" | FieldMode;

const CHOICE_LABELS: Record<FieldChoice, string> = {
  off: "Not from your church's records",
  locked: "From them, locked",
  member: "From them, member can change",
};

export type SettingsField = RecordsField | HouseholdField;

/** Every field a church admin chooses a setting for: people's details, then the household's. */
export const SETTINGS_FIELDS: readonly SettingsField[] = [...RECORDS_FIELDS, ...HOUSEHOLD_FIELDS];

/** The settings a church admin may choose for a field: contact details, dates, the photo and household details can't be locked. */
export function choicesFor(field: SettingsField): { value: FieldChoice; label: string }[] {
  const values: FieldChoice[] = (LOCKABLE_FIELDS as readonly string[]).includes(field)
    ? ["off", "locked", "member"]
    : ["off", "member"];
  return values.map((value) => ({ value, label: CHOICE_LABELS[value] }));
}

/** The request body's settings: a field set to off is left out. */
export function settingsBody(choices: Partial<Record<SettingsField, FieldChoice>>): Partial<Record<SettingsField, FieldMode>> {
  return Object.fromEntries(
    Object.entries(choices).filter((entry): entry is [SettingsField, FieldMode] => entry[1] === "locked" || entry[1] === "member"),
  );
}

/** The counts Refresh now answers with. */
export type RefreshCounts = Pick<
  RefreshResult,
  "copied" | "pending" | "review" | "failed" | "photosSkipped" | "householdsUnavailable"
>;

const people = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`);

/** What Refresh now tells the admin: a warning whenever someone wasn't copied or a photo wasn't available. */
export function refreshMessage({
  copied,
  pending,
  failed,
  photosSkipped,
  householdsUnavailable,
}: Omit<RefreshCounts, "review">): {
  tone: "success" | "warning";
  text: string;
} {
  const updated = copied === 0 ? "Nothing needed updating." : `Updated ${people(copied)}.`;
  const problems = [
    failed > 0 && `${people(failed)} couldn't be copied.`,
    pending > 0 && `${people(pending)} still to copy; the next refresh carries on.`,
    photosSkipped > 0 && `${photosSkipped === 1 ? "1 photo" : `${photosSkipped.toLocaleString("en-US")} photos`} couldn't be used.`,
    householdsUnavailable && "Families couldn't be read, so households weren't refreshed; see the Households tab.",
  ].filter((line): line is string => !!line);
  if (problems.length === 0) return { tone: "success", text: `Refreshed. ${updated}` };
  return { tone: "warning", text: [`Refreshed with problems. ${updated}`, ...problems].join(" ") };
}
