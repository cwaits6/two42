import { createClient } from "@/lib/supabase/client";
import type { MemberGroup } from "@/lib/types";

/**
 * Add or remove a member from a group.
 *
 * @returns an error message to show the user, or null on success
 */
export async function setGroupMembership(
  profileId: string,
  group: MemberGroup,
  member: boolean,
): Promise<string | null> {
  const supabase = createClient();

  if (member) {
    const { error } = await supabase.from("team_members").insert({
      profile_id: profileId,
      team_id: group.id,
    });
    if (error) return `Failed to add to ${group.name}.`;
  } else {
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("profile_id", profileId)
      .eq("team_id", group.id);
    if (error) return `Failed to remove from ${group.name}.`;
  }

  return null;
}
