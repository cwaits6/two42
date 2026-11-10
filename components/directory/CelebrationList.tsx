"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DirSection } from "@/components/directory/DirRow";
import {
  celebrationHref,
  celebrationSections,
  fromCelebration,
  isThisWeek,
  parseWhen,
  type CelebrationTab,
  type CelebrationWhen,
} from "@/components/directory/celebrations";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { EmptyState } from "@/components/states/EmptyState";
import { Button } from "@/components/ui/button";
import { SegmentedLinks } from "@/components/ui/segmented";

const EMPTY_LINK: Partial<Record<CelebrationWhen, { when: CelebrationWhen; label: string }>> = {
  week: { when: "month", label: "Show this month" },
  month: { when: "all", label: "Show all" },
};

const EMPTY_SUFFIX: Record<CelebrationWhen, string> = {
  week: "this week.",
  month: "this month.",
  all: "on record yet.",
};

/**
 * The This week / This month / All filter and the rows it selects, for a tab
 * whose rows recur on a date. The choice lives in the URL, so Back keeps it.
 */
export function CelebrationList<T extends { key: string; month: number; day: number }>({
  tab,
  noun,
  icon,
  entries,
  renderRow,
}: {
  tab: CelebrationTab;
  /** Plural, lower case: "birthdays" */
  noun: string;
  icon: LucideIcon;
  entries: readonly T[];
  /**
   * `soon` is true only where a row itself has to say a date is close: the headings of the other filters already do.
   * `href` turns an entry's path into a link whose panel leads back to this list as it is shown.
   */
  renderRow: (entry: T, soon: boolean, href: (path: string) => string) => ReactNode;
}) {
  const { basePath, today } = useDirectory();
  const searchParams = useSearchParams();
  const when = parseWhen(searchParams.get("when"));
  const filterHref = (filter: CelebrationWhen) =>
    celebrationHref(
      `${basePath}/${tab}`,
      searchParams.toString(),
      "when",
      filter === "all" ? null : filter,
    );
  const rowHref = (entryPath: string) =>
    fromCelebration(`${basePath}${entryPath}`, tab, searchParams);
  const sections = celebrationSections(entries, when, today);
  const emptyLink = EMPTY_LINK[when];

  return (
    <>
      <SegmentedLinks
        label={`Show ${noun} from`}
        className="mb-7 flex w-full *:grow sm:w-fit"
        options={[
          { href: filterHref("week"), label: "This week", current: when === "week" },
          { href: filterHref("month"), label: "This month", current: when === "month" },
          { href: filterHref("all"), label: "All", current: when === "all" },
        ]}
      />

      {sections.length === 0 ? (
        <EmptyState
          icon={icon}
          message={`No ${noun} ${EMPTY_SUFFIX[when]}`}
          action={
            emptyLink && (
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link href={filterHref(emptyLink.when)} />}
              >
                {emptyLink.label}
              </Button>
            )
          }
        />
      ) : (
        sections.map((section) => (
          <DirSection key={section.label} label={section.label}>
            {section.entries.map((entry) =>
              renderRow(entry, when === "all" && isThisWeek(entry.month, entry.day, today), rowHref),
            )}
          </DirSection>
        ))
      )}
    </>
  );
}
