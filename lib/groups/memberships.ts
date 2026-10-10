import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_DEFAULT_COLOR, type ActiveGroup, type GroupRole } from "@/lib/groups/active";

type MembershipRow = {
  group_id: string;
  role: string;
  groups: { name: string } | { name: string }[] | null;
};

function toRole(value: string): GroupRole {
  return value === "leader" ? "leader" : "member";
}

function groupName(row: MembershipRow): string {
  const embedded = Array.isArray(row.groups) ? row.groups[0] : row.groups;
  return embedded?.name ?? "Group";
}

/**
 * The viewer's groups, ordered by joined_at so "first membership" is
 * deterministic. The client is a parameter and so untyped as to privilege;
 * `orgId` must be the caller's already-validated org and the predicate is
 * mandatory. Fails closed to an empty list on error: no group resolves.
 */
export async function loadGroupMemberships(
  client: SupabaseClient<Database>,
  opts: { profileId: string; orgId: string }
): Promise<ActiveGroup[]> {
  const { data, error } = await client
    .from("group_members")
    .select("group_id, role, groups(name)")
    .eq("profile_id", opts.profileId)
    .eq("org_id", opts.orgId)
    .order("joined_at")
    .order("group_id");

  if (error) {
    console.error("Failed to load group memberships:", error);
    return [];
  }

  return ((data ?? []) as MembershipRow[]).map((row) => ({
    id: row.group_id,
    name: groupName(row),
    color: GROUP_DEFAULT_COLOR,
    role: toRole(row.role),
  }));
}
