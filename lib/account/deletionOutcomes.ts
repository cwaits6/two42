import { logError, stepOf } from "@/lib/log";

interface NameParts {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

/** person_deletion_outcomes(): what the delete will do, decided in the database. */
export interface DeletionOutcomes {
  funds: ({ name: string; group_name: string | null } & (
    | { outcome: "passed_on"; recipient: NameParts }
    | { outcome: "needs_recipient"; recipient: null }
  ))[];
  household: { name: string; goes: boolean; entries: (NameParts & { first_name: string })[] } | null;
}

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isOptionalText = (v: unknown) => v === null || isText(v);
const isNameParts = (v: unknown) =>
  isObject(v) && isOptionalText(v.first_name) && isOptionalText(v.last_name) && isOptionalText(v.preferred_name);

function isFund(v: unknown) {
  if (!isObject(v) || !isText(v.name) || !isOptionalText(v.group_name)) return false;
  if (v.outcome === "passed_on") return isNameParts(v.recipient);
  return v.outcome === "needs_recipient" && v.recipient === null;
}

function isHousehold(v: unknown) {
  return (
    v === null ||
    (isObject(v) &&
      isText(v.name) &&
      typeof v.goes === "boolean" &&
      Array.isArray(v.entries) &&
      v.entries.every((e) => isNameParts(e) && isText((e as Fields).first_name)))
  );
}

/**
 * The jsonb is typed `Json` in the generated types, so a key renamed on the SQL
 * side would otherwise read as a fund or household that silently drops out of
 * the confirmation. Throwing takes the same path as a failed read.
 */
export function parseDeletionOutcomes(value: unknown): DeletionOutcomes | null {
  if (value === null) return null;
  if (isObject(value) && Array.isArray(value.funds) && value.funds.every(isFund) && isHousehold(value.household)) {
    return value as unknown as DeletionOutcomes;
  }
  logError("Deletion outcomes had an unexpected shape", null, { step: stepOf("deletion outcomes") });
  throw new Error("deletion outcomes: unexpected shape");
}
