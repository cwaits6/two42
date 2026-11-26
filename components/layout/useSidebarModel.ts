"use client";

import {
  useActiveGroup,
  useDiscoveryOn,
  useGroupMemberships,
} from "@/components/groups/GroupProvider";
import { can } from "@/lib/groups/abilities";
import { buildSidebar, type SidebarItem } from "@/lib/groups/nav";
import { firstGroupSettingsSection } from "@/lib/groups/settingsNav";
import { useGroupWaitingRequests, useSidebar } from "./SidebarContext";

/** The page list for the current viewer and path. */
export function useSidebarModel(): SidebarItem[] {
  const { hasServingAccess, supperClubGroupIds, orgName } = useSidebar();
  const memberships = useGroupMemberships();
  const activeGroup = useActiveGroup();
  const discoveryOn = useDiscoveryOn();
  const reviewsRequests = activeGroup ? can(activeGroup, "members") : false;
  const waitingRequests = useGroupWaitingRequests(reviewsRequests && activeGroup ? activeGroup.id : null);
  return buildSidebar({
    memberships,
    activeGroup,
    discoveryOn,
    settingsHref: activeGroup ? firstGroupSettingsSection(activeGroup) : null,
    waitingRequests,
    hasServingAccess,
    supperClubGroupIds,
    orgName,
  });
}
