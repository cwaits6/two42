"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import type { Profile } from "@/lib/types";

interface AppShellProps {
  profile: Profile | null;
  hasServingAccess: boolean;
  orgName: string;
  children: React.ReactNode;
}

// /serving stays so /serving/go keeps its frame; the rest of /serving/*
// redirects under the group before it renders.
export const SIDEBAR_ROUTES = [
  "/g",
  "/dashboard",
  "/calendar",
  "/directory",
  "/find-a-group",
  "/serving",
  "/profile",
  "/settings",
];

// Boundary-matched so "/g" never claims "/grace/join".
export function isSidebarRoute(pathname: string): boolean {
  return SIDEBAR_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

export function AppShell({ profile, hasServingAccess, orgName, children }: AppShellProps) {
  const pathname = usePathname();
  const isMember =
    profile && ["member", "content_editor", "admin"].includes(profile.role);
  const showSidebar = isMember && isSidebarRoute(pathname);

  if (!showSidebar) {
    // /admin/* and /platform/* supply their own nav via their layouts; a
    // flex main lets those layouts' sidebars stretch to full height.
    const ownsItsNav =
      pathname.startsWith("/admin") || pathname.startsWith("/platform");
    return (
      <main className={ownsItsNav ? "flex flex-1" : "flex-1"}>{children}</main>
    );
  }

  return (
    <div className="flex flex-1">
      <Sidebar profile={profile!} hasServingAccess={hasServingAccess} orgName={orgName} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
