import { nameFieldError } from "@/lib/nameField";
import { normalizePhone, titleCaseName } from "@/lib/sanitize";
import { anniversaryErrors, birthdayErrors, type DateParts } from "@/components/profile/birthday";

/** Messages keyed by the id of the field they belong to, in the order the fields appear. */
export type StepErrors = Record<string, string>;

function addNameError(found: StepErrors, field: string, message: string | undefined) {
  if (message) found[field] = message;
}

export interface AboutYouFields {
  firstName: string;
  lastName: string;
  preferredName: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
}

export function aboutYouErrors(v: AboutYouFields): StepErrors {
  const found: StepErrors = {};
  addNameError(found, "first_name", nameFieldError(titleCaseName(v.firstName), "first name", true));
  addNameError(found, "last_name", nameFieldError(titleCaseName(v.lastName), "last name", true));
  addNameError(
    found,
    "preferred_name",
    nameFieldError(titleCaseName(v.preferredName), "preferred name", false),
  );
  return {
    ...found,
    ...birthdayErrors({ month: v.birthMonth, day: v.birthDay, year: v.birthYear }),
  };
}

export interface ContactFields {
  phoneMobile: string;
  phoneHome: string;
  phoneWork: string;
}

export function contactErrors(v: ContactFields): StepErrors {
  const found: StepErrors = {};
  if (v.phoneMobile && !normalizePhone(v.phoneMobile)) {
    found.phone_mobile = "Enter a valid phone number.";
  }
  if (v.phoneHome && !normalizePhone(v.phoneHome)) found.phone_home = "Enter a valid phone number.";
  if (v.phoneWork && !normalizePhone(v.phoneWork)) found.phone_work = "Enter a valid phone number.";
  return found;
}

/** `anniversary` is the wizard's field set, present only while a spouse is being added. */
export function householdErrors(resolved: boolean, anniversary?: DateParts): StepErrors {
  if (!resolved) return { household: "Find your household, or add a new one." };
  return anniversary ? anniversaryErrors(anniversary) : {};
}

export interface PersonDraft {
  first_name: string;
  last_name: string;
  birth_month: string;
  birth_day: string;
  birth_year: string;
}

/** Errors for the add-a-person form, keyed by its `add_`-prefixed field ids. */
export function personErrors(draft: PersonDraft): StepErrors {
  const found: StepErrors = {};
  addNameError(found, "add_first_name", nameFieldError(titleCaseName(draft.first_name), "first name", true));
  addNameError(found, "add_last_name", nameFieldError(titleCaseName(draft.last_name), "last name", false));
  const birthday = birthdayErrors({
    month: draft.birth_month,
    day: draft.birth_day,
    year: draft.birth_year,
  });
  for (const [field, message] of Object.entries(birthday)) found[`add_${field}`] = message;
  return found;
}
