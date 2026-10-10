import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { loadGroupMemberships } from "@/lib/groups/memberships";
import {
  GROUP_COOKIE,
  isUuid,
  resolveActiveGroup,
  type ActiveGroup,
} from "@/lib/groups/active";

/**
 * The viewer's groups for this request. Memoized with React cache() so the
 * root layout, the group layout, and every page under it share one
 * membership query per request; nothing survives past the request.
 * Anonymous, missing, and pending profiles resolve to no groups.
 */
export const getGroupMemberships = cache(async (): Promise<ActiveGroup[]> => {
  const user = await getOptionalUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.error("Failed to load the viewer's profile for group context:", error);
    return [];
  }
  if (!profile || profile.role === "pending") return [];

  return loadGroupMemberships(supabase, { profileId: user.id, orgId: profile.org_id });
});

/**
 * The group an org-level surface should target when it needs one: the
 * cookie's group when the viewer is in it, else the first membership.
 */
export const getActiveGroup = cache(async (): Promise<ActiveGroup | null> => {
  const memberships = await getGroupMemberships();
  if (memberships.length === 0) return null;
  const cookieStore = await cookies();
  return resolveActiveGroup({
    cookieGroupId: cookieStore.get(GROUP_COOKIE)?.value,
    memberships,
  });
});

/**
 * The group a /g/[groupId] request is about. A malformed id 404s before any
 * query; a signed-in viewer outside the group gets the same 404, never a
 * 403, so the response does not confirm the group exists.
 */
export const requireActiveGroup = cache(async (groupId: string): Promise<ActiveGroup> => {
  if (!isUuid(groupId)) notFound();

  const memberships = await getGroupMemberships();
  const group = resolveActiveGroup({ urlGroupId: groupId, memberships });
  if (group) return group;

  if (!(await getOptionalUser())) redirect("/login");
  notFound();
});

/** For leader-only pages under a group: a member who does not lead it gets a 404. */
export async function requireGroupLeader(groupId: string): Promise<ActiveGroup> {
  const group = await requireActiveGroup(groupId);
  if (group.role !== "leader") notFound();
  return group;
}
