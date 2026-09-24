"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  ChevronDown,
  Cog,
  Megaphone,
  BookOpen,
  Settings,
  Users,
  UserCircle,
  HandHelping,
  HandCoins,
  HeartHandshake,
  Info,
} from "lucide-react";
import { Fragment, useState, useEffect, type ComponentType } from "react";
import type { Profile } from "@/lib/types";

interface SidebarNavProps {
  profile: Profile;
  hasServingAccess: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};

type NavGroup = { label: string | null; items: NavItem[] };

const memberNavGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Content",
    items: [
      { href: "/events", label: "Calendar", icon: Calendar },
      { href: "/announcements", label: "Announcements", icon: Megaphone },
      { href: "/lectures", label: "Lectures", icon: BookOpen },
      { href: "/about", label: "About", icon: Info },
    ],
  },
  {
    label: "Community",
    items: [
      { href: "/directory", label: "Directory", icon: Users },
      { href: "/serving", label: "Serving", icon: HandHelping },
      { href: "/prayer", label: "Prayer", icon: HeartHandshake },
      { href: "/give", label: "Give", icon: HandCoins },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/profile", label: "My Profile", icon: UserCircle },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const directorySubNav = [
  { href: "/directory/families", label: "Families" },
  { href: "/directory/groups", label: "Groups" },
  { href: "/directory/birthdays", label: "Birthdays" },
  { href: "/directory/anniversaries", label: "Anniversaries" },
];

export function SidebarNav({
  profile,
  hasServingAccess,
  collapsed = false,
  onNavigate,
}: SidebarNavProps) {
  const pathname = usePathname();
  const isEditor = profile.role === "admin" || profile.role === "content_editor";

  // Directory sub-menu: auto-opens while browsing the section, manually collapsible
  const inDirectory = pathname === "/directory" || pathname.startsWith("/directory/");
  const [directoryOpen, setDirectoryOpen] = useState(inDirectory);
  useEffect(() => {
    setDirectoryOpen(inDirectory);
  }, [inDirectory]);

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  // Soft-blue active state with a primary left bar, per the design system
  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm border-l-4 transition-colors ${
      active
        ? "bg-brand-warm text-brand-primary font-bold border-brand-primary"
        : "border-transparent font-medium text-slate-600 hover:text-brand-primary hover:bg-brand-warm/50"
    }`;

  const renderLink = (item: NavItem) => {
    const active = isActive(item.href, item.exact);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={linkClass(active)}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        onClick={onNavigate}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  // Directory item with a chevron that expands/collapses its sub-menu
  const renderDirectoryItem = () => {
    const active = isActive("/directory");
    return (
      <div
        className={`flex items-center rounded-lg border-l-4 transition-colors ${
          active
            ? "bg-brand-warm border-brand-primary"
            : "border-transparent hover:bg-brand-warm/50"
        }`}
      >
        <Link
          href="/directory"
          className={`flex flex-1 min-w-0 items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
            active
              ? "text-brand-primary font-bold"
              : "font-medium text-slate-600 hover:text-brand-primary"
          }`}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          <Users className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Directory</span>
        </Link>
        <button
          type="button"
          onClick={() => setDirectoryOpen((open) => !open)}
          aria-label={directoryOpen ? "Collapse directory menu" : "Expand directory menu"}
          aria-expanded={directoryOpen}
          className={`self-stretch px-2.5 transition-colors ${
            active ? "text-brand-primary" : "text-slate-600 hover:text-brand-primary"
          }`}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${directoryOpen ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </button>
      </div>
    );
  };

  const renderDirectorySubNav = () => {
    if (collapsed || !directoryOpen) return null;
    return directorySubNav.map((item) => {
      const active = isActive(item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center pl-11 pr-3 py-2 rounded-lg text-sm border-l-4 transition-colors ${
            active
              ? "bg-brand-warm text-brand-primary font-bold border-brand-primary"
              : "border-transparent font-medium text-slate-600 hover:text-brand-primary hover:bg-brand-warm/50"
          }`}
          aria-current={active ? "page" : undefined}
          onClick={onNavigate}
        >
          {item.label}
        </Link>
      );
    });
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {memberNavGroups.map((group) => (
          <Fragment key={group.label ?? "top"}>
            {group.label && !collapsed && (
              <p className="px-3 pt-4 pb-1 text-sm font-bold uppercase text-muted-foreground tracking-wider">
                {group.label}
              </p>
            )}
            {group.label && collapsed && (
              <div className="border-t border-border my-2" role="separator" />
            )}
            {group.items
              .filter((item) => item.href !== "/serving" || hasServingAccess)
              .map((item) => (
                <Fragment key={item.href}>
                  {item.href === "/directory" && !collapsed ? renderDirectoryItem() : renderLink(item)}
                  {item.href === "/directory" && renderDirectorySubNav()}
                </Fragment>
              ))}
          </Fragment>
        ))}

        {isEditor && (
          <div className="mt-2 border-t border-border pt-2">
            {renderLink({ href: "/admin", label: "Admin", icon: Cog })}
          </div>
        )}
      </div>
    </>
  );
}
