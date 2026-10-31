"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ComponentType } from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { adminNavGroups } from "@/lib/admin-nav";
import { platformNavItems } from "@/lib/platform-nav";

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
    sections: [
      { items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }] },
      ...adminNavGroups.map((group) => ({ label: group.label, items: group.items })),
    ],
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
  className,
  onNavigate,
}: {
  area: AreaKey;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label={AREAS[area].label} className={`flex-col space-y-1 ${className ?? "flex"}`}>
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        Back to Home
      </Link>
      <div className="border-t border-border my-2" role="separator" />
      {AREAS[area].sections.map((section, i) => (
        <Fragment key={section.label ?? i}>
          {section.label && (
            <p className="px-3 pt-4 pb-1 text-sm font-semibold uppercase text-muted-foreground tracking-wider">
              {section.label}
            </p>
          )}
          {section.items.map((item) => {
            const active = isActive(item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-base border-l-4 transition-colors ${
                  active
                    ? "bg-brand-warm text-brand-primary-text font-bold border-brand-primary"
                    : "border-transparent font-medium text-muted-foreground hover:text-brand-primary-text hover:bg-brand-warm/50"
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}

/** The area's persistent rail on desktop; on phone the same nav lives in the header menu. */
export function AreaSidebar({ area }: { area: AreaKey }) {
  return (
    <AreaNav
      area={area}
      className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-card px-2 py-4 md:flex"
    />
  );
}
