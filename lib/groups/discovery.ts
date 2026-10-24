import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { toDiscoverableGroup, type DiscoverableGroup } from "@/lib/groups/joining";

/**
 * Whether members of this org can find and request to join groups: the
 * org's group_discovery switch, read through the cookie-bound request
 * client, which returns only the caller's own organizations row. Memoized
 * for the request because the root layout, /dashboard and /find-a-group
 * all read it. A failed read or no row resolves to false, the fail-closed
 * value: discovery then reads as off everywhere the way it did before the
 * column existed, and discoverable_groups() / join_group() enforce the
 * truth regardless of what the UI offers.
 */
export const getDiscoveryOn = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("group_discovery")
    .maybeSingle();
  if (error) {
    console.error("Failed to load the group discovery setting:", error);
    return false;
  }
  if (!data) {
    console.warn("No organization row visible for this request; group discovery unknown");
    return false;
  }
  return data.group_discovery === true;
});

/**
 * The groups the viewer may see on Find a group: their own always, others
 * as discoverable_groups() decides. Null on a failed read so the page can
 * say so rather than claim there are no groups.
 */
export async function getDiscoverableGroups(): Promise<DiscoverableGroup[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discoverable_groups");
  if (error) {
    console.error("Failed to load discoverable groups:", error);
    return null;
  }
  return (data ?? []).map(toDiscoverableGroup);
}
