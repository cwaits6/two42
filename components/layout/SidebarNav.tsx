"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Calendar,
  Compass,
  HandCoins,
  HandHelping,
  HeartHandshake,
  Home,
  Info,
  Megaphone,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Fragment, type ComponentType } from "react";
import type { IconName, SidebarItem, SidebarLink } from "@/lib/groups/nav";
import { GroupSwitcher } from "./GroupSwitcher";
import { WaitingCount } from "./WaitingCount";

interface SidebarNavProps {
  items: SidebarItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}

const ICONS: Record<IconName, ComponentType<{ className?: string }>> = {
  home: Home,
  calendar: Calendar,
  directory: Users,
  announcements: Megaphone,
  lectures: BookOpen,
  about: Info,
  serving: HandHelping,
  prayer: HeartHandshake,
  give: HandCoins,
  "group-settings": SlidersHorizontal,
  "find-a-group": Compass,
};

export function SidebarNav({ items, collapsed, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  // Warm active state with a primary left bar, per the design system
  const linkClass = (active: boolean, quiet: boolean) =>
    `flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg border-l-4 transition-colors ${
      quiet ? "text-sm" : "text-base"
    } ${
      active
        ? "bg-brand-warm text-brand-primary-text font-bold border-brand-primary"
        : `border-transparent text-muted-foreground hover:text-brand-primary-text hover:bg-brand-warm/50 ${
            quiet ? "font-normal" : "font-medium"
          }`
    }`;

  const renderLink = (item: SidebarLink) => {
    const active = isActive(item.href, item.exact);
    const Icon = ICONS[item.icon];
    const named = item.count ? `${item.label}, ${item.count} waiting` : item.label;
    return (
      <Link
        href={item.href}
        className={linkClass(active, item.quiet === true)}
        aria-current={active ? "page" : undefined}
        title={collapsed ? named : undefined}
        onClick={onNavigate}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
        {item.count ? <WaitingCount count={item.count} collapsed={collapsed} /> : null}
      </Link>
    );
  };

  const renderItem = (item: SidebarItem) => {
    switch (item.kind) {
      case "link":
        return renderLink(item);
      case "groupBlock":
        return <GroupSwitcher block={item} collapsed={collapsed} onNavigate={onNavigate} />;
      case "gap":
        return <div className="h-3" aria-hidden="true" />;
      case "separator":
        return <div className="border-t border-border my-2" role="separator" />;
    }
  };

  return items.map((item, i) => (
    <Fragment key={item.kind === "link" ? item.href : `${item.kind}-${i}`}>{renderItem(item)}</Fragment>
  ));
}
