"use client";

import {
  useActiveGroup,
  useDiscoveryOn,
  useGroupMemberships,
} from "@/components/groups/GroupProvider";
import { buildSidebar, type SidebarItem } from "@/lib/groups/nav";
import { useGroupWaitingRequests, useSidebar } from "./SidebarContext";

/** The page list for the current viewer and path. */
export function useSidebarModel(): SidebarItem[] {
  const { hasServingAccess, orgName } = useSidebar();
  const memberships = useGroupMemberships();
  const activeGroup = useActiveGroup();
  const discoveryOn = useDiscoveryOn();
  const isLeader = activeGroup?.role === "leader";
  const waitingRequests = useGroupWaitingRequests(isLeader ? activeGroup.id : null);
  return buildSidebar({
    memberships,
    activeGroup,
    discoveryOn,
    isLeader,
    waitingRequests,
    hasServingAccess,
    orgName,
  });
}
