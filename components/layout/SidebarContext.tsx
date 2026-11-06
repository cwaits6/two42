"use client";

import { createContext, useContext, useState } from "react";
import type { Account } from "./account";

interface SidebarContextValue {
  /** Null when signed out. */
  account: Account | null;
  hasServingAccess: boolean;
  orgName: string;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({
  account,
  hasServingAccess,
  orgName,
  children,
}: Pick<SidebarContextValue, "account" | "hasServingAccess" | "orgName"> & { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarContext.Provider value={{ account, hasServingAccess, orgName, collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
