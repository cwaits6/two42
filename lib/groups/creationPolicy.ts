import { createClient } from "@/lib/supabase/server";
import { parseGroupCreationPolicy, type GroupCreationPolicy } from "@/lib/groups/creation";

/**
 * The caller's org's group_creation_policy, read through the cookie-bound
 * request client, which returns only the caller's own organizations row.
 * A failed read or no row resolves to approval, the fail-closed default:
 * the UI then offers "Request a group" at most, and RLS plus group_create()
 * enforce the truth regardless of what the UI offers.
 */
export async function getGroupCreationPolicy(): Promise<GroupCreationPolicy> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("group_creation_policy")
    .maybeSingle();
  if (error) {
    console.error("Failed to load the group creation policy:", error);
    return "approval";
  }
  if (!data) {
    console.warn("No organization row visible for this request; group creation policy unknown");
    return "approval";
  }
  return parseGroupCreationPolicy(data.group_creation_policy);
}
