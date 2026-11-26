import { parsePhoneNumberFromString, AsYouType } from "libphonenumber-js";
import { titleCaseName } from "@/supabase/functions/_shared/name-case";

/**
 * Input sanitization for member directory fields.
 *
 * All functions are pure — they take a raw string and return the normalized
 * form. Pass the result straight into the database. Empty / whitespace-only
 * input returns null so we can cleanly clear optional fields.
 */

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

export { titleCaseName };

/**
 * Alias for titleCaseName — "john smith" → "John Smith".
 * Exported separately for callers that prefer this name.
 */
export const toTitleCase = titleCaseName;

// -----------------------------------------------------------------------------
// Phone numbers
// -----------------------------------------------------------------------------

/**
 * Parse a user-entered phone number into E.164 (`+15551234567`) for storage.
 * Assumes US as the default country — works for plain 10-digit and +1 formats.
 * Returns null if the input is empty or unparseable.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}

/**
 * Format an E.164 phone number for display: `+15551234567` → `(555) 123-4567`.
 * Falls back to the raw input if it can't be parsed.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  // National format for US numbers, international for everything else.
  return parsed.country === "US"
    ? parsed.formatNational()
    : parsed.formatInternational();
}

/**
 * Live-format a phone number as the user types. Used in input `onChange`
 * handlers so the field reformats as they enter digits.
 */
export function formatPhoneAsYouType(raw: string): string {
  return new AsYouType("US").input(raw);
}

// -----------------------------------------------------------------------------
// Address
// -----------------------------------------------------------------------------

export { normalizePostalCode, normalizeState, titleCaseCity, titleCaseStreet } from "@/supabase/functions/_shared/address-case";

// -----------------------------------------------------------------------------
// Email + plain text
// -----------------------------------------------------------------------------

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed || null;
}

/**
 * Trim and collapse internal whitespace. Use for freeform text fields like
 * bio, occupation, employer where no case enforcement applies.
 */
export function trimText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed || null;
}
