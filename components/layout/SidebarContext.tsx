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
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  account,
  hasServingAccess,
  orgName,
  waitingRequests = null,
  children,
}: Pick<SidebarContextValue, "account" | "hasServingAccess" | "orgName"> &
  Partial<Pick<SidebarContextValue, "waitingRequests">> & { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ account, hasServingAccess, orgName, waitingRequests, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

/** The waiting count for the menu, or null outside the frame. */
export function useWaitingRequests(): number | null {
  return useContext(SidebarContext)?.waitingRequests ?? null;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
