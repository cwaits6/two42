import { normalizePhone, titleCaseName } from "@/lib/sanitize";
import { birthdayErrors } from "@/components/profile/birthday";

/** Messages keyed by the id of the field they belong to, in the order the fields appear. */
export type StepErrors = Record<string, string>;

export interface AboutYouFields {
  firstName: string;
  lastName: string;
  birthMonth: string;
  birthDay: string;
  birthYear: string;
}

export function aboutYouErrors(v: AboutYouFields): StepErrors {
  const found: StepErrors = {};
  if (!titleCaseName(v.firstName)) found.first_name = "Enter a first name.";
  if (!titleCaseName(v.lastName)) found.last_name = "Enter a last name.";
  return {
    ...found,
    ...birthdayErrors({ month: v.birthMonth, day: v.birthDay, year: v.birthYear }),
  };
}

export interface ContactFields {
  phoneMobile: string;
  phoneHome: string;
  phoneWork: string;
  hidePhoneMobile: boolean;
  hideEmail: boolean;
}

/** The same reachability rule the profile form applies after setup. */
export function contactErrors(v: ContactFields): StepErrors {
  const found: StepErrors = {};
  const reachable =
    (v.phoneMobile && !v.hidePhoneMobile) || v.phoneHome || v.phoneWork || !v.hideEmail;
  if (!reachable) {
    found.phone_mobile = "Add a phone number, or keep your email visible so people can reach you.";
  }
  if (v.phoneMobile && !normalizePhone(v.phoneMobile)) {
    found.phone_mobile = "Enter a valid phone number.";
  }
  if (v.phoneHome && !normalizePhone(v.phoneHome)) found.phone_home = "Enter a valid phone number.";
  if (v.phoneWork && !normalizePhone(v.phoneWork)) found.phone_work = "Enter a valid phone number.";
  return found;
}

export function householdErrors(resolved: boolean): StepErrors {
  return resolved ? {} : { household: "Find your household, or add a new one." };
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
  if (!titleCaseName(draft.first_name)) found.add_first_name = "Enter a first name.";
  const birthday = birthdayErrors({
    month: draft.birth_month,
    day: draft.birth_day,
    year: draft.birth_year,
  });
  for (const [field, message] of Object.entries(birthday)) found[`add_${field}`] = message;
  return found;
}
