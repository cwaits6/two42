import { isMemberRole } from "@/lib/roles";

/** The page and the join button both explain the different-account refusal with this. */
export const DIFFERENT_ACCOUNT_TEXT =
  "This invite was sent to a different email address. Sign out, then open the link again with the account it was sent to.";

export interface HouseholdInviteFacts {
  invite: { org_id: string; family_id: string; invite_email: string; accepted_at: string | null };
  member: { family_id: string; claimed_profile_id: string | null } | null;
  profile: { org_id: string; role: string; family_id: string | null } | null;
  user: { id: string; email?: string };
}

/**
 * - `joined`: a used invite whose person is already in its household, so a
 *   repeat press succeeds without writing.
 * - `invalid`: used, stale, naming a member someone else claimed, or sent to
 *   this address while the account is pending or in another church; it reads
 *   as every other dead link, so another church's invite is never confirmed.
 * - `different_account`: the invite was sent to another address.
 * - `other_household`: moving someone between households is a church admin's
 *   call, never an invite's.
 */
export type HouseholdInviteVerdict =
  | "joined"
  | "invalid"
  | "different_account"
  | "other_household"
  | "joinable";

/** Shared by the page and the join route so the step shown and the claim allowed never disagree. */
export function householdInviteVerdict({ invite, member, profile, user }: HouseholdInviteFacts): HouseholdInviteVerdict {
  const sameAddress = user.email?.toLowerCase() === invite.invite_email.toLowerCase();

  if (invite.accepted_at) {
    return sameAddress && profile?.family_id === invite.family_id ? "joined" : "invalid";
  }
  if (!sameAddress) return "different_account";
  if (
    !profile ||
    !isMemberRole(profile.role) ||
    profile.org_id !== invite.org_id ||
    !member ||
    member.family_id !== invite.family_id ||
    (member.claimed_profile_id !== null && member.claimed_profile_id !== user.id)
  ) {
    return "invalid";
  }
  if (profile.family_id !== null && profile.family_id !== invite.family_id) return "other_household";
  return "joinable";
}
