"use client";

import {
  useActiveGroup,
  useDiscoveryOn,
  useGroupMemberships,
} from "@/components/groups/GroupProvider";
import { buildSidebar, type SidebarItem } from "@/lib/groups/nav";
import { useSidebar } from "./SidebarContext";

/** The page list for the current viewer and path. */
export function useSidebarModel(): SidebarItem[] {
  const { hasServingAccess, orgName } = useSidebar();
  const memberships = useGroupMemberships();
  const activeGroup = useActiveGroup();
  const discoveryOn = useDiscoveryOn();
  return buildSidebar({
    memberships,
    activeGroup,
    discoveryOn,
    isLeader: activeGroup?.role === "leader",
    hasServingAccess,
    orgName,
  });
}
