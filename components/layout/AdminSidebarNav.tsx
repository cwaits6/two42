"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ComponentType } from "react";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { adminNavGroups } from "@/lib/admin-nav";

const overviewItem = { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true };

export function AdminSidebarNav() {
  const pathname = usePathname();
  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  // Soft-blue active state with a primary left bar, per the design system
  const linkClass = (active: boolean) =>
    `flex min-h-11 items-center gap-3 px-3 py-2.5 rounded-lg text-base border-l-4 transition-colors ${
      active
        ? "bg-brand-warm text-brand-primary-text font-bold border-brand-primary"
        : "border-transparent font-medium text-slate-600 hover:text-brand-primary-text hover:bg-brand-warm/50"
    }`;

  const renderLink = (
    item: { href: string; label: string; icon: ComponentType<{ className?: string }>; exact?: boolean },
  ) => {
    const active = isActive(item.href, item.exact);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={linkClass(active)}
        aria-current={active ? "page" : undefined}
      >
        <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    );
  };

  const backLink = (
    <Link
      href="/dashboard"
      className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      Back to app
    </Link>
  );

  return (
    <>
      {/* Desktop: persistent grouped sidebar */}
      <nav
        aria-label="Admin navigation"
        className="hidden w-60 shrink-0 flex-col space-y-1 overflow-y-auto border-r border-border bg-white px-2 py-4 md:flex"
      >
        {backLink}
        <div className="border-t border-border my-2" role="separator" />
        {renderLink(overviewItem)}
        {adminNavGroups.map((group) => (
          <Fragment key={group.key}>
            <p className="px-3 pt-4 pb-1 text-sm font-semibold uppercase text-muted-foreground tracking-wider">
              {group.label}
            </p>
            {group.items.map(renderLink)}
          </Fragment>
        ))}
      </nav>

      {/* Mobile: horizontally scrollable bar of the same destinations */}
      <nav
        aria-label="Admin navigation"
        className="flex items-center gap-2 overflow-x-auto border-b border-border bg-white px-4 py-2 md:hidden"
      >
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 pr-1 text-base font-semibold text-brand-primary-text underline underline-offset-4"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back
        </Link>
        {[overviewItem, ...adminNavGroups.flatMap((group) => group.items)].map((item) => {
          const active = isActive(item.href, "exact" in item ? item.exact : undefined);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-base transition-colors ${
                active
                  ? "border-brand-primary bg-brand-warm font-bold text-brand-primary-text"
                  : "border-border font-medium text-slate-600 hover:text-brand-primary-text"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
