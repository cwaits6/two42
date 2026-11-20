export const EDIT_MY_DETAILS_HREF = "/profile";

/** The viewer's own person entry. An absent viewer id owns nothing. */
export function isOwnEntry(profile: { id: string }, viewerId: string | undefined): boolean {
  return !!viewerId && profile.id === viewerId;
}

/** The viewer's own household. A viewer without a household owns none. */
export function isOwnHousehold(family: { id: string }, viewerFamilyId: string | null): boolean {
  return !!viewerFamilyId && family.id === viewerFamilyId;
}
