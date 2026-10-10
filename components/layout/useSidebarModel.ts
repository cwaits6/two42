"use client";

import {
  useActiveGroup,
  useDiscoveryOn,
  useGroupMemberships,
} from "@/components/groups/GroupProvider";
import { buildSidebar, type SidebarModel } from "@/lib/groups/nav";
import type { Profile } from "@/lib/types";

/** The sidebar model for the current viewer, path, and surface. */
export function useSidebarModel(input: {
  profile: Profile;
  hasServingAccess: boolean;
  orgName: string;
  collapsed: boolean;
  phone: boolean;
}): SidebarModel {
  const memberships = useGroupMemberships();
  const activeGroup = useActiveGroup();
  const discoveryOn = useDiscoveryOn();
  return buildSidebar({
    memberships,
    activeGroup,
    discoveryOn,
    isLeader: activeGroup?.role === "leader",
    isOrgAdmin: input.profile.role === "admin",
    isContentEditor: input.profile.role === "content_editor",
    hasServingAccess: input.hasServingAccess,
    collapsed: input.collapsed,
    phone: input.phone,
    orgName: input.orgName,
  });
}
