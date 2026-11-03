import type { Profile } from "@/lib/types";

/** Only the primary or spouse in a household can edit another enrolled member's profile. */
export function canEditSpouseProfiles(profile: Pick<Profile, "relationship">): boolean {
  return profile.relationship === "primary" || profile.relationship === "spouse";
}

/**
 * The smallest explicit rule available without collecting a birth date: someone
 * listed as a child with no account of their own. A child with an account is an
 * adult child, which is what "Child (adult)" means when linking a member. The
 * family_members triggers and family_directory_people() enforce the same
 * predicate in SQL, and nothing binds the two: change them together.
 */
export function isChildWithoutAccount(person: {
  relationship: string | null;
  claimed_profile_id?: string | null;
}): boolean {
  return person.relationship === "child" && !person.claimed_profile_id;
}

export const CHILD_INVITE_REFUSED =
  "A child listed here can't be invited to their own account, since accounts are for people signing up for themselves.";

/** Fields shown for household members the viewer can't open the edit sheet for. */
export type HouseholdSummary = Pick<
  Profile,
  "id" | "first_name" | "last_name" | "preferred_name" | "relationship" | "role" | "avatar_url"
>;
