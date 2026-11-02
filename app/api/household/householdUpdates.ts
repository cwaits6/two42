import {
  titleCaseName,
  titleCaseStreet,
  titleCaseCity,
  normalizePhone,
  normalizeState,
  normalizePostalCode,
} from "@/lib/sanitize";
import { anniversaryColumns, anniversaryErrors } from "@/components/profile/birthday";

export type HouseholdUpdatesResult =
  | { updates: Record<string, unknown> }
  | { error: string; status: 400 | 403 };

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
  const {
    family_name,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    phone_home,
    phone_profile_id,
    anniversary_month,
    anniversary_day,
    anniversary_year,
  } = body;

  const updates: Record<string, unknown> = {};

  if (family_name !== undefined) {
    const name = titleCaseName(String(family_name));
    if (!name) return { error: "Family name is required", status: 400 };
    updates.family_name = name;
  }
  if (address_line1 !== undefined) updates.address_line1 = titleCaseStreet(String(address_line1 ?? "")) || null;
  if (address_line2 !== undefined) updates.address_line2 = titleCaseStreet(String(address_line2 ?? "")) || null;
  if (city !== undefined) updates.city = titleCaseCity(String(city ?? "")) || null;
  if (state !== undefined) {
    const stateCode = state ? normalizeState(String(state)) : null;
    if (state && !stateCode) return { error: "Invalid state", status: 400 };
    updates.state = stateCode;
  }
  if (postal_code !== undefined) {
    const postal = postal_code ? normalizePostalCode(String(postal_code)) : null;
    if (postal_code && !postal) return { error: "Invalid ZIP code", status: 400 };
    updates.postal_code = postal;
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
      if (phone_home && !phone) return { error: "Invalid home phone", status: 400 };
      updates.phone_home = phone;
      // A typed number replaces a choice this form hadn't seen yet.
      if (phone) updates.phone_profile_id = null;
    }
  }

  if (anniversary_month !== undefined || anniversary_day !== undefined || anniversary_year !== undefined) {
    const parts = {
      month: String(anniversary_month ?? ""),
      day: String(anniversary_day ?? ""),
      year: String(anniversary_year ?? ""),
    };
    const [message] = Object.values(anniversaryErrors(parts));
    if (message) return { error: message, status: 400 };
    Object.assign(updates, anniversaryColumns(parts));
  }

  return { updates };
}
