"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import type { Profile } from "@/lib/types";

interface AppShellProps {
  profile: Profile | null;
  hasServingAccess: boolean;
  children: React.ReactNode;
}

export const SIDEBAR_ROUTES = [
  "/dashboard",
  "/events",
  "/announcements",
  "/lectures",
  "/directory",
  "/serving",
  "/prayer",
  "/profile",
  "/settings",
];

// The public content pages route lives under an org slug segment
// (/[orgSlug]/pages/[slug]) rather than a fixed top-level prefix, so it
// can't join the plain-prefix list above — match "pages" as the second
// path segment instead. Excludes /admin and /platform, which own their
// own nav below and would otherwise match "pages" as a fake org slug.
const ORG_SCOPED_PAGES_ROUTE = /^\/(?!admin\/|platform\/)[^/]+\/pages(\/|$)/;

export function isSidebarRoute(pathname: string): boolean {
  return (
    SIDEBAR_ROUTES.some((r) => pathname.startsWith(r)) ||
    ORG_SCOPED_PAGES_ROUTE.test(pathname)
  );
}

export function AppShell({ profile, hasServingAccess, children }: AppShellProps) {
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
      <Sidebar profile={profile!} hasServingAccess={hasServingAccess} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
