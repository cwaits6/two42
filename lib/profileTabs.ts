/** Query param value for the Household tab on /profile, shared with the /household redirect stub. */
export const HOUSEHOLD_TAB = "household";

/** The link to the Household tab on /profile. */
export function profileHouseholdHref(): string {
  return `/profile?tab=${HOUSEHOLD_TAB}`;
}
