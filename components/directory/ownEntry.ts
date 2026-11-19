import { HOUSEHOLD_TAB } from "@/lib/profileTabs";
import type { FamilyDirectoryFull } from "@/lib/types";

export const EDIT_MY_DETAILS_HREF = "/profile";
export const EDIT_HOUSEHOLD_HREF = `/profile?tab=${HOUSEHOLD_TAB}`;

/** The viewer's own person entry. An absent viewer id owns nothing. */
export function isOwnEntry(profile: { id: string }, viewerId: string | undefined): boolean {
  return !!viewerId && profile.id === viewerId;
}

/** The household the viewer belongs to, judged by its members with a profile. */
export function isOwnHousehold(
  family: Pick<FamilyDirectoryFull, "members">,
  viewerId: string | undefined,
): boolean {
  return !!viewerId && family.members.some((m) => m.id === viewerId);
}
