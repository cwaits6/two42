import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { displayName } from "@/lib/names";

export interface AdminGroupRow {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  /** Display names of the group's leaders, sorted. */
  leaderNames: string[];
}

/**
 * Where a row in Admin > Groups opens: the group itself for a church admin in
 * it. The group's pages answer 404 to anyone else, church admins included, so
 * otherwise it opens the group's admin page.
 */
export function adminGroupHref(groupId: string, memberGroupIds: readonly string[]): string {
  return memberGroupIds.includes(groupId) ? `/g/${groupId}/dashboard` : `/admin/groups/${groupId}`;
}

/**
 * Every group in the church with its member count and leaders, read through
 * the caller's cookie-bound client, whose admin arm returns the whole org.
 * The role filter applies to the aliased leaders embed only, so groups with
 * no leader still come back, with an empty list. Null when the read fails.
 */
export async function listAdminGroups(
  client: SupabaseClient<Database>,
): Promise<AdminGroupRow[] | null> {
  const { data, error } = await client
    .from("groups")
    .select(
      "id, name, description, members:group_members(count), leaders:group_members(profiles(first_name, last_name, preferred_name))",
    )
    .eq("leaders.role", "leader")
    .order("name", { ascending: true });
  if (error) {
    console.error("Failed to load groups:", error);
    return null;
  }
  return data.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g.members[0]?.count ?? 0,
    leaderNames: g.leaders
      .map((l) => displayName(Array.isArray(l.profiles) ? l.profiles[0] : l.profiles))
      .sort((a, b) => a.localeCompare(b)),
  }));
}
