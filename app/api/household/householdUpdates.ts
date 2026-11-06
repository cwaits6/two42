import {
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
  normalizePhone,
  normalizeState,
  normalizePostalCode,
} from "@/lib/sanitize";
import {
  anniversaryColumns,
  anniversaryErrors,
  type AnniversaryErrors,
  type DateParts,
} from "@/components/profile/birthday";

export type HouseholdUpdatesResult =
  | { updates: Record<string, unknown> }
  | { error: string; status: 400 | 403 };

export type HouseholdFieldErrors = Partial<
  Record<"family_name" | "state" | "postal_code" | "phone_home", string>
> &
  AnniversaryErrors;

/** The anniversary a body carries, or null when it names no part of one. */
function anniversaryParts(body: Record<string, unknown>): DateParts | null {
  const { anniversary_month, anniversary_day, anniversary_year } = body;
  if (anniversary_month === undefined && anniversary_day === undefined && anniversary_year === undefined) {
    return null;
  }
  return {
    month: String(anniversary_month ?? ""),
    day: String(anniversary_day ?? ""),
    year: String(anniversary_year ?? ""),
  };
}

/**
 * What is wrong with a household PATCH body, by field, in the household form's
 * order. The form marks its fields with this before saving and the route
 * refuses with the first message, so the two judge a value the same way. A key
 * left out of the body is not judged.
 */
export function householdFieldErrors(body: Record<string, unknown>): HouseholdFieldErrors {
  const { family_name, state, postal_code, phone_home, phone_profile_id } = body;
  const errors: HouseholdFieldErrors = {};

  if (family_name !== undefined && !titleCaseName(String(family_name))) {
    errors.family_name = "Enter a household name.";
  }
  if (state && !normalizeState(String(state))) {
    errors.state = "Enter a 2-letter state, like TX.";
  }
  if (postal_code && !normalizePostalCode(String(postal_code))) {
    errors.postal_code = "Enter a 5-digit ZIP code, or ZIP+4.";
  }
  // A spouse's own number replaces the typed one, which is then never written.
  if (phone_home && !phone_profile_id && !normalizePhone(String(phone_home))) {
    errors.phone_home = "Enter a valid phone number.";
  }
  const anniversary = anniversaryParts(body);
  if (anniversary) Object.assign(errors, anniversaryErrors(anniversary));

  return errors;
}

/**
 * A household PATCH body as the columns to write. Keys left out of the body are
 * left alone, so the form can send only the phone choice that changed. Retired
 * keys (the hide flags and the single anniversary date) are ignored: the flags
 * are never written, so a flag set before the migration keeps its gate.
 */
export function householdUpdates(
  body: Record<string, unknown>,
  userId: string,
): HouseholdUpdatesResult {
  const { family_name, address_line1, address_line2, city, state, postal_code, phone_home, phone_profile_id } =
    body;

  const [message] = Object.values(householdFieldErrors(body));
  if (message) return { error: message, status: 400 };

  const updates: Record<string, unknown> = {};

  if (family_name !== undefined) updates.family_name = titleCaseName(String(family_name));
  if (address_line1 !== undefined) updates.address_line1 = titleCaseStreet(String(address_line1 ?? "")) || null;
  if (address_line2 !== undefined) updates.address_line2 = titleCaseStreet(String(address_line2 ?? "")) || null;
  if (city !== undefined) updates.city = titleCaseCity(String(city ?? "")) || null;
  if (state !== undefined) updates.state = state ? normalizeState(String(state)) : null;
  if (postal_code !== undefined) {
    updates.postal_code = postal_code ? normalizePostalCode(String(postal_code)) : null;
  }

  if (phone_profile_id !== undefined && phone_profile_id !== null && phone_profile_id !== userId) {
    return { error: "Only that spouse can choose their own number.", status: 403 };
  }
  if (phone_profile_id) {
    updates.phone_profile_id = phone_profile_id;
    updates.phone_home = null;
  } else {
    if (phone_profile_id === null) updates.phone_profile_id = null;
    if (phone_home !== undefined) {
      const phone = phone_home ? normalizePhone(String(phone_home)) : null;
      updates.phone_home = phone;
      // A typed number replaces a choice this form hadn't seen yet.
      if (phone) updates.phone_profile_id = null;
    }
  }

  const anniversary = anniversaryParts(body);
  if (anniversary) Object.assign(updates, anniversaryColumns(anniversary));

  return { updates };
}
