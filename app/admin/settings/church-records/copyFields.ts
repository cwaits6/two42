import {
  type FieldMode,
  LOCKABLE_FIELDS,
  RECORDS_FIELDS,
  type RecordsField,
} from "@/supabase/functions/_shared/records-copy";
import type { RefreshResult } from "@/supabase/functions/_shared/records-refresh";

export type FieldChoice = "off" | FieldMode;

const CHOICE_LABELS: Record<FieldChoice, string> = {
  off: "Not from your church's records",
  locked: "From them, locked",
  member: "From them, member can change",
};

/** The settings a church admin may choose for a field: contact details, dates and the photo can't be locked. */
export function choicesFor(field: RecordsField): { value: FieldChoice; label: string }[] {
  const values: FieldChoice[] = LOCKABLE_FIELDS.includes(field) ? ["off", "locked", "member"] : ["off", "member"];
  return values.map((value) => ({ value, label: CHOICE_LABELS[value] }));
}

export { RECORDS_FIELDS };

/** The request body's settings: a field set to off is left out. */
export function settingsBody(choices: Partial<Record<RecordsField, FieldChoice>>): Partial<Record<RecordsField, FieldMode>> {
  return Object.fromEntries(
    Object.entries(choices).filter((entry): entry is [RecordsField, FieldMode] => entry[1] === "locked" || entry[1] === "member"),
  );
}

/** The counts Refresh now answers with. */
export type RefreshCounts = Pick<RefreshResult, "copied" | "pending" | "review" | "failed" | "photosSkipped">;

const people = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`);

/** What Refresh now tells the admin: a warning whenever someone wasn't copied or a photo wasn't available. */
export function refreshMessage({ copied, pending, failed, photosSkipped }: Omit<RefreshCounts, "review">): {
  tone: "success" | "warning";
  text: string;
} {
  const updated = copied === 0 ? "Nothing needed updating." : `Updated ${people(copied)}.`;
  const problems = [
    failed > 0 && `${people(failed)} couldn't be copied.`,
    pending > 0 && `${people(pending)} still to copy; the next refresh carries on.`,
    photosSkipped > 0 && `${photosSkipped === 1 ? "1 photo" : `${photosSkipped.toLocaleString("en-US")} photos`} couldn't be used.`,
  ].filter((line): line is string => !!line);
  if (problems.length === 0) return { tone: "success", text: `Refreshed. ${updated}` };
  return { tone: "warning", text: [`Refreshed with problems. ${updated}`, ...problems].join(" ") };
}
