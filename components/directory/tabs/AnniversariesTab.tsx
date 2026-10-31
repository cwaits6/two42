"use client";

import { useMemo } from "react";
import { Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DirRow, DirSection } from "@/components/directory/DirRow";
import { EmptyState } from "@/components/states/EmptyState";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import {
  MONTH_NAMES,
  daysUntilNextOccurrence,
  formatNextOccurrence,
  monthCycle,
  nextOccurrence,
} from "@/components/directory/utils";
import type { FamilyDirectoryFull } from "@/lib/types";

interface AnniversaryEntry {
  familyId: string;
  coupleName: string;
  photoUrl: string | null;
  initial: string;
  month: number;
  day: number;
  marriedYear: number;
  years: number;
  daysUntil: number;
}

/** "Frank & Susan Miller" — the couple's first names plus the family name */
function coupleName(family: FamilyDirectoryFull): string {
  const primary = family.members.find((m) => m.relationship === "primary");
  const spouse =
    family.members.find((m) => m.relationship === "spouse") ||
    family.family_members_list.find((fm) => fm.relationship === "spouse");
  const firsts = [primary, spouse]
    .filter(Boolean)
    .map((p) => p!.preferred_name || p!.first_name)
    .filter(Boolean)
    .join(" & ");
  return firsts ? `${firsts} ${family.family_name}` : family.family_name;
}

function AnniversariesTabInner() {
  const { families, basePath } = useDirectory();

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const currentMonth = today.getMonth() + 1;

  const byMonth = useMemo(() => {
    const map: Record<number, AnniversaryEntry[]> = {};
    for (const family of families) {
      const hasSpouse =
        family.members.some((m) => m.relationship === "spouse") ||
        family.family_members_list.some((fm) => fm.relationship === "spouse");
      if (!family.anniversary || !hasSpouse) continue;

      const d = new Date(family.anniversary + "T00:00:00");
      const month = d.getMonth() + 1;
      const day = d.getDate();
      map[month] ??= [];
      map[month].push({
        familyId: family.id,
        coupleName: coupleName(family),
        photoUrl: family.photo_url,
        initial: family.family_name.charAt(0).toUpperCase(),
        month,
        day,
        marriedYear: d.getFullYear(),
        years: nextOccurrence(month, day, today).getFullYear() - d.getFullYear(),
        daysUntil: daysUntilNextOccurrence(month, day, today),
      });
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.day - b.day);
    }
    return map;
  }, [families, today]);

  const months = monthCycle(currentMonth).filter((m) => byMonth[m]?.length);

  if (months.length === 0) {
    return (
      <EmptyState icon={Heart} message="No anniversaries on record yet." />
    );
  }

  return months.map((month) => (
    <DirSection
      key={month}
      label={`${MONTH_NAMES[month - 1]}${month === currentMonth ? " — this month" : ""}`}
    >
      {byMonth[month].map((entry) => {
        const soon = entry.daysUntil <= 7;
        return (
          <DirRow
            key={entry.familyId}
            href={`${basePath}/families?family=${entry.familyId}`}
            highlight={soon}
            avatar={
              <Avatar className="h-12 w-12">
                {entry.photoUrl && <AvatarImage src={entry.photoUrl} alt={entry.coupleName} />}
                <AvatarFallback className="bg-brand-primary text-white">
                  {entry.initial}
                </AvatarFallback>
              </Avatar>
            }
            title={entry.coupleName}
            subtitle={`${formatNextOccurrence(entry.month, entry.day, today)} · married ${entry.marriedYear}`}
            trailing={
              soon ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-accent bg-brand-bg-light px-3.5 py-1 text-sm font-semibold text-brand-accent-text">
                  <Heart className="h-4 w-4" aria-hidden="true" />
                  {entry.years} years
                </span>
              ) : undefined
            }
          />
        );
      })}
    </DirSection>
  ));
}

export function AnniversariesTab() {
  return (
    <DirectoryLoadState>
      <AnniversariesTabInner />
    </DirectoryLoadState>
  );
}
