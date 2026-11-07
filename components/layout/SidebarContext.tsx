"use client";

import { createContext, useContext, useState } from "react";
import type { Account } from "./account";

interface SidebarContextValue {
  /** Null when signed out. */
  account: Account | null;
  hasServingAccess: boolean;
  orgName: string;
  /** Requests waiting on a church admin; null for anyone else, or when they could not be counted. */
  waitingRequests: number | null;
  /** Requests to join waiting on each group the viewer leads; a group is absent when it could not be counted. */
  groupWaitingRequests: Record<string, number>;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const NO_GROUP_COUNTS: Record<string, number> = {};

export function SidebarProvider({
  account,
  hasServingAccess,
  orgName,
  waitingRequests = null,
  groupWaitingRequests = NO_GROUP_COUNTS,
  children,
}: Pick<SidebarContextValue, "account" | "hasServingAccess" | "orgName"> &
  Partial<Pick<SidebarContextValue, "waitingRequests" | "groupWaitingRequests">> & { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ account, hasServingAccess, orgName, waitingRequests, groupWaitingRequests, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

/** The waiting count for the menu, or null outside the frame. */
export function useWaitingRequests(): number | null {
  return useContext(SidebarContext)?.waitingRequests ?? null;
}

/** A group's waiting requests to join for its leader; null at zero, when not counted, or outside the frame. */
export function useGroupWaitingRequests(groupId: string | null | undefined): number | null {
  const counts = useContext(SidebarContext)?.groupWaitingRequests;
  const count = groupId ? counts?.[groupId] : undefined;
  return count ? count : null;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
