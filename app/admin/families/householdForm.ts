import {
  titleCaseCity,
  titleCaseName,
  titleCaseStreet,
  normalizePhone,
  normalizePostalCode,
  normalizeState,
} from "@/lib/sanitize";

export interface HouseholdFormState {
  family_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  phone_home: string;
  anniversary: string;
  hide_address: boolean;
  hide_phone_home: boolean;
}

/** In the form's order, so the first invalid field is the first one here. */
export const HOUSEHOLD_FIELDS = ["family_name", "state", "postal_code", "phone_home"] as const;
export type HouseholdField = (typeof HOUSEHOLD_FIELDS)[number];
export type HouseholdErrors = Partial<Record<HouseholdField, string>>;

export function validateHousehold(form: HouseholdFormState) {
  const familyName = titleCaseName(form.family_name);
  const state = form.state ? normalizeState(form.state) : null;
  const postal = form.postal_code ? normalizePostalCode(form.postal_code) : null;
  const phone = form.phone_home ? normalizePhone(form.phone_home) : null;

  const errors: HouseholdErrors = {};
  if (!familyName) errors.family_name = "Enter a household name.";
  if (form.state && !state) errors.state = "Enter a state, like TX.";
  if (form.postal_code && !postal) errors.postal_code = "Enter a ZIP code, like 78701.";
  if (form.phone_home && !phone) errors.phone_home = "Enter a 10-digit phone number.";

  return {
    errors,
    payload: {
      family_name: familyName,
      address_line1: titleCaseStreet(form.address_line1),
      address_line2: titleCaseStreet(form.address_line2),
      city: titleCaseCity(form.city),
      state,
      postal_code: postal,
      phone_home: phone,
      anniversary: form.anniversary || null,
      hide_address: form.hide_address,
      hide_phone_home: form.hide_phone_home,
    },
  };
}
