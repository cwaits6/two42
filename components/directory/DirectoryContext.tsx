"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
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
import { LiveDetailsProvider, useLiveDirectory } from "@/components/directory/LiveDetailsContext";
import { applyLiveDetails } from "@/components/directory/liveDetails";
import { calendarDate } from "@/components/directory/utils";
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
  currentFamilyId: string | null;
  /** Local midnight of the church's calendar date, never the browser's. */
  today: Date;
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
  currentFamilyId: string | null;
  /** The church's calendar date, "YYYY-MM-DD", read by the layout in the org's time zone. */
  today: string;
  /** Whether the church shows some details live from its records, which the directory then asks for once. */
  recordsLive: boolean;
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
  currentFamilyId,
  today,
  recordsLive,
  children,
}: DirectoryProviderProps) {
  const churchToday = useMemo(() => calendarDate(today), [today]);
  const memberships = useGroupMemberships();
  const membershipIds = useMemo(() => memberships.map((g) => g.id), [memberships]);
  const data = useDirectoryData(membershipIds);
  const live = useLiveDirectory(recordsLive);
  const merged = useMemo(
    () => applyLiveDetails(data.members, data.families, live.controls?.live ?? null),
    [data.members, data.families, live.controls],
  );
  const profileMap = useMemo(
    () => (merged.members === data.members ? data.profileMap : Object.fromEntries(merged.members.map((m) => [m.id, m]))),
    [merged.members, data.members, data.profileMap],
  );
  const familyMap = useMemo(
    () => (merged.families === data.families ? data.familyMap : Object.fromEntries(merged.families.map((f) => [f.id, f]))),
    [merged.families, data.families, data.familyMap],
  );
  const { reload: reloadData } = data;
  const { reload: reloadLive } = live;
  const reload = useCallback(() => {
    reloadData();
    reloadLive();
  }, [reloadData, reloadLive]);

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
    () => scopeMembers(merged.members, scope, data.groupRosters, membershipIds),
    [merged.members, scope, data.groupRosters, membershipIds]
  );
  const families = useMemo(
    () => scopeFamilies(merged.families, scope, data.groupRosters, membershipIds),
    [merged.families, scope, data.groupRosters, membershipIds]
  );

  const value: DirectoryContextValue = {
    scope,
    setScope,
    options,
    showControl,
    members,
    families,
    profileMap,
    familyMap,
    groupRosters: data.groupRosters,
    groupsByProfile: data.groupsByProfile,
    memberships,
    activeGroupId,
    orgName,
    basePath,
    currentUserId,
    currentFamilyId,
    today: churchToday,
    loading: data.loading,
    error: data.error,
    reload,
  };

  return (
    <DirectoryContext.Provider value={value}>
      <LiveDetailsProvider value={live.controls}>{children}</LiveDetailsProvider>
    </DirectoryContext.Provider>
  );
}

export function useDirectory(): DirectoryContextValue {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error("useDirectory() must be used inside DirectoryProvider");
  return value;
}
