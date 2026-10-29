"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  DirectoryProvider,
  type DirectoryProviderProps,
} from "@/components/directory/DirectoryContext";
import { ScopeControl } from "@/components/directory/ScopeControl";
import { cn } from "@/lib/utils";

const TABS = [
  { path: "", label: "Members" },
  { path: "/families", label: "Families" },
  { path: "/birthdays", label: "Birthdays" },
  { path: "/anniversaries", label: "Anniversaries" },
  { path: "/groups", label: "Groups" },
] as const;

/**
 * The one directory: heading, the five tab links, the scope control, and
 * the shared data under them. Rendered by the org-level and the group-level
 * directory layouts with a different basePath and default scope.
 */
export function DirectoryShell({ children, ...provider }: DirectoryProviderProps) {
  return (
    <DirectoryProvider {...provider}>
      <PageContainer size="wide">
        <PageHeader title="Directory" className="mb-6" />
        <TabStrip basePath={provider.basePath} />
        <ScopeControl />
        {children}
      </PageContainer>
    </DirectoryProvider>
  );
}

function TabStrip({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Directory sections" className="mb-7 border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-x-2">
        {TABS.map((tab) => {
          const href = `${basePath}${tab.path}`;
          const active = tab.path === "" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={tab.path}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center border-b-4 px-3 text-base font-semibold transition-colors",
                  active
                    ? "border-brand-primary text-brand-primary-text"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
