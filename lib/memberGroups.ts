import { failureMessage } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";
import type { MemberGroup } from "@/lib/types";

// A fetch that never got an answer comes back from PostgREST with status 0.
function failure(status: number): number | "network" {
  return status === 0 ? "network" : status;
}

/**
 * Add a person to a team or remove them from it. Both writes select the row
 * they touched, because a write RLS filters to nothing reports success.
 *
 * @returns an error message to show the user, or null on success
 */
export async function setGroupMembership(
  person: { id: string; name: string },
  group: Pick<MemberGroup, "id" | "name">,
  member: boolean,
): Promise<string | null> {
  const supabase = createClient();

  if (member) {
    const { data, error, status } = await supabase
      .from("team_members")
      .insert({ profile_id: person.id, team_id: group.id })
      .select("profile_id");
    if (error || !data?.length) {
      return failureMessage(`add ${person.name} to ${group.name}`, error ? failure(status) : undefined, {
        409: `${person.name} is already on ${group.name}.`,
      });
    }
  } else {
    const { data, error, status } = await supabase
      .from("team_members")
      .delete()
      .eq("profile_id", person.id)
      .eq("team_id", group.id)
      .select("profile_id");
    if (error || !data?.length) {
      return failureMessage(`remove ${person.name} from ${group.name}`, error ? failure(status) : undefined);
    }
  }

  return null;
}
