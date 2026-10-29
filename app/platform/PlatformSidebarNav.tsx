"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { platformNavItems, type PlatformNavItem } from "@/lib/platform-nav";

export function PlatformSidebarNav() {
  const pathname = usePathname();

  const isActive = (href: string, exact = false) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  // Soft-blue active state with a primary left bar, per the design system
  const linkClass = (active: boolean) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm border-l-4 transition-colors ${
      active
        ? "bg-brand-warm text-brand-primary-text font-bold border-brand-primary"
        : "border-transparent font-medium text-slate-600 hover:text-brand-primary-text hover:bg-brand-warm/50"
    }`;

  const renderLink = (item: PlatformNavItem) => {
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

  return (
    <>
      {/* Desktop: persistent sidebar */}
      <nav
        aria-label="Platform navigation"
        className="hidden w-60 shrink-0 flex-col space-y-1 overflow-y-auto border-r border-border bg-white px-2 py-4 md:flex"
      >
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center gap-2 px-3 text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back to app
        </Link>
        <div className="border-t border-border my-2" role="separator" />
        {platformNavItems.map(renderLink)}
      </nav>

      {/* Mobile: horizontally scrollable bar of the same destinations */}
      <nav
        aria-label="Platform navigation"
        className="flex items-center gap-2 overflow-x-auto border-b border-border bg-white px-4 py-2 md:hidden"
      >
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 pr-1 text-base font-semibold text-brand-primary-text underline underline-offset-4"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Back
        </Link>
        {platformNavItems.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm transition-colors ${
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
