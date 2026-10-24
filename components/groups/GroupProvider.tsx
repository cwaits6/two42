"use client";

import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { groupIdFromPath, type ActiveGroup } from "@/lib/groups/active";
import type { GroupCreationPolicy } from "@/lib/groups/creation";

export type GroupCreation = {
  policy: GroupCreationPolicy;
  isOrgAdmin: boolean;
};

type GroupContextValue = {
  memberships: ActiveGroup[];
  discoveryOn: boolean;
  creation: GroupCreation;
};

const GroupContext = createContext<GroupContextValue>({
  memberships: [],
  discoveryOn: false,
  creation: { policy: "approval", isOrgAdmin: false },
});

export function GroupProvider({
  memberships,
  discoveryOn,
  creation,
  children,
}: GroupContextValue & { children: ReactNode }) {
  return (
    <GroupContext.Provider value={{ memberships, discoveryOn, creation }}>
      {children}
    </GroupContext.Provider>
  );
}

export function useGroupMemberships(): ActiveGroup[] {
  return useContext(GroupContext).memberships;
}

export function useDiscoveryOn(): boolean {
  return useContext(GroupContext).discoveryOn;
}

export function useGroupCreation(): GroupCreation {
  return useContext(GroupContext).creation;
}

/**
 * The group the current page is inside: the URL's group when the viewer is
 * in it, else the viewer's only group (a one-group member is always inside
 * it), else null at the org level. The cookie never counts here: a member
 * of two groups on /calendar is at the org level whatever they last opened.
 */
export function useActiveGroup(): ActiveGroup | null {
  const memberships = useGroupMemberships();
  const pathname = usePathname();
  const urlGroupId = groupIdFromPath(pathname);
  if (urlGroupId) {
    return memberships.find((g) => g.id === urlGroupId) ?? null;
  }
  return memberships.length === 1 ? memberships[0] : null;
}
