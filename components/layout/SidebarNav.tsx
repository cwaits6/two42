"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Calendar,
  ChevronDown,
  Cog,
  Compass,
  HandCoins,
  HandHelping,
  HeartHandshake,
  Home,
  Info,
  LayoutDashboard,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  UserCircle,
  Users,
} from "lucide-react";
import { Fragment, useEffect, useState, type ComponentType } from "react";
import type { IconName, SidebarItem, SidebarLink, SidebarModel } from "@/lib/groups/nav";
import { GroupSwitcher } from "./GroupSwitcher";
import { useSidebar } from "./SidebarContext";

interface SidebarNavProps {
  model: SidebarModel;
  onNavigate?: () => void;
}

const ICONS: Record<IconName, ComponentType<{ className?: string }>> = {
  home: Home,
  dashboard: LayoutDashboard,
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
  profile: UserCircle,
  settings: Settings,
  admin: Cog,
};

export function SidebarNav({ model, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const { setCollapsed } = useSidebar();
  const { collapsed } = model;

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  // Directory sub-menu: auto-opens while browsing the section, manually collapsible
  const directory = model.items.find((item) => item.kind === "directory");
  const inDirectory = directory ? isActive(directory.href) : false;
  const [directoryOpen, setDirectoryOpen] = useState(inDirectory);
  useEffect(() => {
    setDirectoryOpen(inDirectory);
  }, [inDirectory]);

  // Soft-blue active state with a primary left bar, per the design system
  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm border-l-4 transition-colors ${
      active
        ? "bg-brand-warm text-brand-primary font-bold border-brand-primary"
        : "border-transparent font-medium text-slate-600 hover:text-brand-primary hover:bg-brand-warm/50"
    }`;

  const renderLink = (item: SidebarLink) => {
    const active = isActive(item.href, item.exact);
    const Icon = ICONS[item.icon];
    return (
      <Link
        href={item.href}
        className={linkClass(active)}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        onClick={onNavigate}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  const renderDirectory = (item: Extract<SidebarItem, { kind: "directory" }>) => {
    const active = isActive(item.href);
    if (collapsed) {
      return renderLink({ kind: "link", href: item.href, label: "Directory", icon: "directory" });
    }
    return (
      <>
        <div
          className={`flex items-center rounded-lg border-l-4 transition-colors ${
            active
              ? "bg-brand-warm border-brand-primary"
              : "border-transparent hover:bg-brand-warm/50"
          }`}
        >
          <Link
            href={item.href}
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
        {directoryOpen &&
          item.children.map((child) => {
            const childActive =
              child.href === item.href ? pathname === child.href : isActive(child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                className={`flex items-center pl-11 pr-3 py-2 rounded-lg text-sm border-l-4 transition-colors ${
                  childActive
                    ? "bg-brand-warm text-brand-primary font-bold border-brand-primary"
                    : "border-transparent font-medium text-slate-600 hover:text-brand-primary hover:bg-brand-warm/50"
                }`}
                aria-current={childActive ? "page" : undefined}
                onClick={onNavigate}
              >
                {child.label}
              </Link>
            );
          })}
      </>
    );
  };

  const renderYourGroups = (item: Extract<SidebarItem, { kind: "yourGroups" }>) => (
    <>
      {!collapsed && (
        <p className="px-3 pt-4 pb-1 text-sm font-bold uppercase text-muted-foreground tracking-wider">
          Your groups
        </p>
      )}
      {item.rows.map((row) => (
        <Link
          key={row.group.id}
          href={row.href}
          className={linkClass(false)}
          title={collapsed ? row.group.name : undefined}
          onClick={onNavigate}
        >
          <span
            aria-hidden="true"
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: row.group.color }}
          />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{row.group.name}</span>
              {row.group.role === "leader" && (
                <span className="shrink-0 rounded border border-brand-accent/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-accent-text">
                  Leader
                </span>
              )}
            </>
          )}
          {collapsed && <span className="sr-only">{row.group.name}</span>}
        </Link>
      ))}
    </>
  );

  const renderItem = (item: SidebarItem) => {
    switch (item.kind) {
      case "link":
        return renderLink(item);
      case "directory":
        return renderDirectory(item);
      case "groupBlock":
        return <GroupSwitcher block={item} collapsed={collapsed} onNavigate={onNavigate} />;
      case "yourGroups":
        return renderYourGroups(item);
      case "separator":
        return <div className="border-t border-border my-2" role="separator" />;
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {model.items.map((item, i) => (
          <Fragment key={item.kind === "link" || item.kind === "directory" ? item.href : `${item.kind}-${i}`}>
            {renderItem(item)}
          </Fragment>
        ))}
      </div>
      {model.showCollapseControl && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand menu" : undefined}
          className={`${linkClass(false)} mt-2 w-full`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Collapse menu</span>
            </>
          )}
        </button>
      )}
    </>
  );
}
