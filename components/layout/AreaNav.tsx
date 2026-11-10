"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ComponentType } from "react";
import { ArrowLeft } from "lucide-react";
import { adminNavGroups } from "@/lib/admin-nav";
import { groupPath } from "@/lib/groups/active";
import { GROUP_REQUESTS_SECTION, groupSettingsNavItems } from "@/lib/groups/settingsNav";
import { platformNavItems } from "@/lib/platform-nav";
import { useGroupWaitingRequests, useWaitingRequests } from "./SidebarContext";
import { WaitingCount } from "./WaitingCount";

type AreaLink = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
};

type Area = {
  label: string;
  /** The way out of the area, above its pages; null when it would lead back here. */
  back: { href: string; label: string } | null;
  sections: { label?: string; items: AreaLink[] }[];
  /** The one page that carries the waiting count. */
  counted?: string;
};

export type AreaKey = "admin" | "platform" | "groupSettings";

const BACK_TO_HOME = { href: "/dashboard", label: "Back to Home" };

const AREAS: Record<Exclude<AreaKey, "groupSettings">, Area> = {
  admin: {
    label: "Admin navigation",
    back: BACK_TO_HOME,
    sections: adminNavGroups.map((group) => ({ label: group.label, items: group.items })),
    counted: "/admin/requests",
  },
  platform: {
    label: "Platform navigation",
    back: BACK_TO_HOME,
    sections: [{ items: platformNavItems }],
  },
};

type AreaGroup = { id: string; name: string };

function groupSettingsArea(group: AreaGroup): Area {
  return {
    label: "Group settings navigation",
    back: { href: groupPath(group.id, "/dashboard"), label: `Back to ${group.name}` },
    sections: [{ items: groupSettingsNavItems(group.id) }],
    counted: groupPath(group.id, GROUP_REQUESTS_SECTION),
  };
}

/** The area whose own nav replaces the member nav on this path, if any. */
export function areaFor(pathname: string): AreaKey | null {
  const under = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (under("/admin")) return "admin";
  if (under("/platform")) return "platform";
  if (/^\/g\/[^/]+\/settings(\/|$)/.test(pathname)) return "groupSettings";
  return null;
}

/** An area's destinations, led by the way back out of it. */
export function AreaNav(
  props: (
    | { area: "admin" }
    | { area: "platform"; hasChurch: boolean }
    | { area: "groupSettings"; group: AreaGroup }
  ) & {
    /** The collapsed sidebar: icons alone, each still named for a screen reader. */
    collapsed?: boolean;
    onNavigate?: () => void;
  },
) {
  const { collapsed = false, onNavigate } = props;
  const pathname = usePathname();
  const group = props.area === "groupSettings" ? props.group : null;
  const area =
    props.area === "groupSettings"
      ? groupSettingsArea(props.group)
      : props.area === "platform" && !props.hasChurch
        ? { ...AREAS.platform, back: null }
        : AREAS[props.area];
  const churchWaiting = useWaitingRequests();
  const groupWaiting = useGroupWaitingRequests(group?.id);
  const waiting = group ? groupWaiting : churchWaiting;
  // Only Requests carries a number, and only while something is waiting.
  const countFor = (href: string) => (href === area.counted && waiting ? waiting : null);
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav aria-label={area.label} className="flex flex-col space-y-1">
      {area.back && (
        <>
          <Link
            href={area.back.href}
            onClick={onNavigate}
            title={collapsed ? area.back.label : undefined}
            className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className={collapsed ? "sr-only" : undefined}>{area.back.label}</span>
          </Link>
          <div className="border-t border-border my-2" role="separator" />
        </>
      )}
      {area.sections.map((section, i) => (
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
                {count !== null && <WaitingCount count={count} collapsed={collapsed} />}
              </Link>
            );
          })}
        </Fragment>
      ))}
    </nav>
  );
}
