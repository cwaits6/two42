"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useGroupMemberships } from "@/components/groups/GroupProvider";
import {
  directoryScopeOptions,
  scopeFamilies,
  scopeMembers,
  scopeValue,
  type DirectoryScope,
  type GroupRosters,
  type ScopeOption,
} from "@/components/directory/scope";
import { useDirectoryData } from "@/components/directory/useDirectoryData";
import type { ActiveGroup } from "@/lib/groups/active";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

export interface DirectoryContextValue {
  scope: DirectoryScope;
  setScope: (scope: DirectoryScope) => void;
  options: ScopeOption[];
  showControl: boolean;
  /** The people and households in the current scope. */
  members: DirectoryProfile[];
  families: FamilyDirectoryFull[];
  /** Every profile and household the viewer may read, for deep links and panels. */
  profileMap: Record<string, DirectoryProfile>;
  familyMap: Record<string, FamilyDirectoryFull>;
  groupRosters: GroupRosters;
  groupsByProfile: Record<string, string[]>;
  memberships: ActiveGroup[];
  activeGroupId: string | null;
  orgName: string;
  basePath: string;
  currentUserId: string;
  loading: boolean;
  error: boolean;
  reload: () => void;
}

const DirectoryContext = createContext<DirectoryContextValue | null>(null);

export interface DirectoryProviderProps {
  orgName: string;
  activeGroupId: string | null;
  orgVisible: boolean;
  basePath: string;
  currentUserId: string;
  children: ReactNode;
}

/**
 * Loads the directory once for every tab under it and holds the scope, so
 * a scope chosen on Members is still in force on Birthdays. The provider
 * lives in the route layout, which persists across sibling pages.
 */
export function DirectoryProvider({
  orgName,
  activeGroupId,
  orgVisible,
  basePath,
  currentUserId,
  children,
}: DirectoryProviderProps) {
  const memberships = useGroupMemberships();
  const membershipIds = useMemo(() => memberships.map((g) => g.id), [memberships]);
  const data = useDirectoryData(membershipIds);

  const { options, defaultScope, showControl } = useMemo(
    () => directoryScopeOptions({ memberships, activeGroupId, orgVisible, orgName }),
    [memberships, activeGroupId, orgVisible, orgName]
  );
  const [chosen, setScope] = useState<DirectoryScope | null>(null);
  // A chosen scope the option list no longer offers (memberships changed
  // under it) falls back to the default rather than showing an empty list.
  const scope =
    chosen && options.some((o) => o.value === scopeValue(chosen)) ? chosen : defaultScope;

  const members = useMemo(
    () => scopeMembers(data.members, scope, data.groupRosters, membershipIds),
    [data.members, scope, data.groupRosters, membershipIds]
  );
  const families = useMemo(
    () => scopeFamilies(data.families, scope, data.groupRosters, membershipIds),
    [data.families, scope, data.groupRosters, membershipIds]
  );

  const value: DirectoryContextValue = {
    scope,
    setScope,
    options,
    showControl,
    members,
    families,
    profileMap: data.profileMap,
    familyMap: data.familyMap,
    groupRosters: data.groupRosters,
    groupsByProfile: data.groupsByProfile,
    memberships,
    activeGroupId,
    orgName,
    basePath,
    currentUserId,
    loading: data.loading,
    error: data.error,
    reload: data.reload,
  };

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory(): DirectoryContextValue {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error("useDirectory() must be used inside DirectoryProvider");
  return value;
}
