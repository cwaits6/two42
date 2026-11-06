"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ComponentType } from "react";
import { ArrowLeft } from "lucide-react";
import { adminNavGroups } from "@/lib/admin-nav";
import { platformNavItems } from "@/lib/platform-nav";
import { useWaitingRequests } from "./SidebarContext";

type AreaLink = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};

type Area = {
  label: string;
  sections: { label?: string; items: AreaLink[] }[];
};

export type AreaKey = "admin" | "platform";

const AREAS: Record<AreaKey, Area> = {
  admin: {
    label: "Admin navigation",
    sections: adminNavGroups.map((group) => ({ label: group.label, items: group.items })),
  },
  platform: {
    label: "Platform navigation",
    sections: [{ items: platformNavItems }],
  },
};

/** The area whose own nav replaces the member nav on this path, if any. */
export function areaFor(pathname: string): AreaKey | null {
  const under = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (under("/admin")) return "admin";
  if (under("/platform")) return "platform";
  return null;
}

/** An area's destinations, led by the way back to Home. */
export function AreaNav({
  area,
  collapsed = false,
  onNavigate,
}: {
  area: AreaKey;
  /** The collapsed sidebar: icons alone, each still named for a screen reader. */
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const waiting = useWaitingRequests();
  // Only Requests carries a number, and only while something is waiting.
  const countFor = (href: string) => (href === "/admin/requests" && waiting ? waiting : null);
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label={AREAS[area].label} className="flex flex-col space-y-1">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        title={collapsed ? "Back to Home" : undefined}
        className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : undefined}>Back to Home</span>
      </Link>
      <div className="border-t border-border my-2" role="separator" />
      {AREAS[area].sections.map((section, i) => (
        <Fragment key={section.label ?? i}>
          {section.label && !collapsed && (
            <p className="px-3 pt-4 pb-1 text-sm font-semibold uppercase text-muted-foreground tracking-wider">
              {section.label}
            </p>
          )}
          {section.items.map((item) => {
            const active = isActive(item.href, item.exact);
            const count = countFor(item.href);
            const named = count === null ? item.label : `${item.label}, ${count} waiting`;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? named : undefined}
                className={`flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-base border-l-4 transition-colors ${
                  active
                    ? "bg-brand-warm text-brand-primary-text font-bold border-brand-primary"
                    : "border-transparent font-medium text-muted-foreground hover:text-brand-primary-text hover:bg-brand-warm/50"
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
                {count !== null && (
                  <>
                    {!collapsed && (
                      <span
                        aria-hidden="true"
                        className="ml-auto min-w-7 rounded-full bg-primary px-2 text-center text-sm font-semibold text-primary-foreground"
                      >
                        {count}
                      </span>
                    )}
                    <span className="sr-only">, {count} waiting</span>
                  </>
                )}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
