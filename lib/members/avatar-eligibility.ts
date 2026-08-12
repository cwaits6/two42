/**
 * Whether `caller` is allowed to write `target`'s avatar object in storage —
 * a pure mirror of the two write arms granted by the storage RLS policies in
 * supabase/migrations/20260803000000_storage_org_partitioned_policies.sql:
 * a caller writing their own avatar, and a household leader (relationship
 * `primary` or `spouse`) writing another enrolled member of the *same*
 * household. Used by the admin member-edit page to decide whether to show
 * the photo control at all (CWA-62 / #337) — without this check, an admin
 * editing a profile with no matching storage write arm sees the control,
 * then hits "Failed to upload photo" on save.
 *
 * Every branch here is a security decision:
 * - A null `family_id` on both sides is NOT a match — two members outside
 *   any household are not the same household.
 * - `family_id` equality alone is not enough: the storage policy also
 *   requires the caller's own `relationship` be `primary` or `spouse`. An
 *   admin who merely shares a household with the target (e.g. a child or
 *   sibling) has no storage write arm either.
 */
export interface AvatarEligibilityCaller {
  id: string;
  family_id: string | null;
  relationship: string | null;
}

export interface AvatarEligibilityTarget {
  id: string;
  family_id: string | null;
}

export function canManageAvatar(
  caller: AvatarEligibilityCaller,
  target: AvatarEligibilityTarget
): boolean {
  if (caller.id === target.id) return true;
  return (
    !!caller.family_id &&
    caller.family_id === target.family_id &&
    (caller.relationship === "primary" || caller.relationship === "spouse")
  );
}
