/**
 * The empty and length checks for a person's name, with the messages every
 * name field shows. Kept free of server imports so forms and routes share it.
 */
import { titleCaseName } from "@/lib/sanitize";

export const MAX_NAME_LENGTH = 100;

export type NameLabel = "first name" | "last name" | "preferred name";

/** Expects the normalized value, so the length counts what would be saved. */
export function nameFieldError(
  name: string | null | undefined,
  label: NameLabel,
  required: boolean,
): string | undefined {
  if (!name) return required ? `Enter a ${label}.` : undefined;
  if (name.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  return undefined;
}

const MEMBER_NAME_FIELDS = [
  ["first_name", "first name", true],
  ["last_name", "last name", false],
  ["preferred_name", "preferred name", false],
] as const;

export type MemberNameField = (typeof MEMBER_NAME_FIELDS)[number][0];

/**
 * Title-cases and checks the name columns of a household member body. On an
 * update only the fields present in the body are checked and returned; a
 * cleared optional name is saved as null.
 */
export function memberNames(
  body: Record<string, unknown>,
  mode: "create" | "update",
): {
  names: Partial<Record<MemberNameField, string | null>>;
  fieldErrors: Partial<Record<MemberNameField, string>>;
} {
  const names: Partial<Record<MemberNameField, string | null>> = {};
  const fieldErrors: Partial<Record<MemberNameField, string>> = {};
  for (const [field, label, required] of MEMBER_NAME_FIELDS) {
    const raw = body[field];
    if (mode === "update" && raw === undefined) continue;
    const name = titleCaseName(typeof raw === "string" ? raw : null);
    const error = nameFieldError(name, label, required);
    if (error) fieldErrors[field] = error;
    else names[field] = name;
  }
  return { names, fieldErrors };
}
