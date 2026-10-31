"use client";

import { usePathname } from "next/navigation";
import { areaFor } from "./AreaNav";
import { Sidebar } from "./Sidebar";
import type { Profile } from "@/lib/types";
import { isMemberRole } from "@/lib/roles";

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

// The header is about 4.25rem tall; filling the rest keeps a short page from
// floating the footer up the screen.
const MAIN_MIN_HEIGHT = "min-h-[calc(100dvh-4.25rem)]";

export function AppShell({ profile, hasServingAccess, orgName, children }: AppShellProps) {
  const pathname = usePathname();
  const isMember = profile && isMemberRole(profile.role);
  const showSidebar = isMember && isSidebarRoute(pathname);

  if (!showSidebar) {
    // /admin/* and /platform/* supply their own nav via their layouts; a
    // flex main lets those layouts' sidebars stretch to full height.
    return (
      <main className={`${MAIN_MIN_HEIGHT} flex-1 ${areaFor(pathname) ? "flex" : ""}`}>
        {children}
      </main>
    );
  }

  return (
    <div className="flex flex-1">
      <Sidebar profile={profile!} hasServingAccess={hasServingAccess} orgName={orgName} />
      <main className={`${MAIN_MIN_HEIGHT} flex-1 overflow-y-auto`}>{children}</main>
    </div>
  );
}
