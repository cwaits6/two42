/**
 * Field validation for inviting one person, shared by the form and the
 * route so both report the same message against the same field. Kept free
 * of server imports so the client component can use it.
 */

export interface InvitePersonInput {
  email: string;
  firstName: string;
  lastName: string;
  householdId: string | null;
}

export type InvitePersonField = "email" | "firstName" | "lastName" | "householdId";

export type InvitePersonErrors = Partial<Record<InvitePersonField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nameError(value: string, label: string): string | undefined {
  if (!value) return `Enter a ${label}.`;
  if (value.length > MAX_NAME_LENGTH) {
    return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  return undefined;
}

/**
 * Normalizes untrusted input and reports every invalid field at once. An
 * empty household means none was chosen.
 */
export function validateInvitePerson(raw: unknown): {
  input: InvitePersonInput;
  errors: InvitePersonErrors;
} {
  const body = (raw ?? {}) as Record<string, unknown>;
  const input: InvitePersonInput = {
    email: normalizeEmail(text(body.email)),
    firstName: text(body.firstName),
    lastName: text(body.lastName),
    householdId: text(body.householdId) || null,
  };

  const errors: InvitePersonErrors = {};
  if (!input.email) {
    errors.email = "Enter an email address.";
  } else if (!EMAIL_PATTERN.test(input.email)) {
    errors.email = "Enter an email address like name@example.com.";
  }
  const firstName = nameError(input.firstName, "first name");
  if (firstName) errors.firstName = firstName;
  const lastName = nameError(input.lastName, "last name");
  if (lastName) errors.lastName = lastName;
  if (input.householdId && !UUID_PATTERN.test(input.householdId)) {
    errors.householdId = "Choose a household from the list.";
  }

  return { input, errors };
}
