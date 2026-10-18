"use client";

import { useMemo, useState } from "react";
import { Cake } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { displayName, initials } from "@/lib/names";
import { BackLink } from "@/components/directory/BackLink";
import { DirRow, DirSectionLabel } from "@/components/directory/DirRow";
import { useDirectoryData } from "@/components/directory/useDirectoryData";
import { useDirectoryHref } from "@/components/directory/useDirectoryHref";
import { DirectoryListSkeleton } from "@/components/directory/DirectoryListSkeleton";
import {
  MONTH_NAMES,
  daysUntilNextOccurrence,
  formatDaysUntil,
  formatNextOccurrence,
  monthCycle,
} from "@/components/directory/utils";

interface BirthdayEntry {
  key: string;
  /** Links to the person's directory profile when they have one */
  profileId: string | null;
  name: string;
  avatarUrl: string | null;
  initials: string;
  month: number;
  day: number;
  daysUntil: number;
  isClassMember: boolean;
}

export default function BirthdaysPage() {
  const { members, families, loading } = useDirectoryData();
  const directoryHref = useDirectoryHref();
  const [includeNonClassMembers, setIncludeNonClassMembers] = useState(false);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const currentMonth = today.getMonth() + 1;

  const entries = useMemo<BirthdayEntry[]>(() => {
    const result: BirthdayEntry[] = [];

    for (const m of members) {
      if (!m.birth_month || !m.birth_day) continue;
      result.push({
        key: `profile-${m.id}`,
        profileId: m.id,
        name: displayName(m),
        avatarUrl: m.avatar_url,
        initials: initials(m),
        month: m.birth_month,
        day: m.birth_day,
        daysUntil: daysUntilNextOccurrence(m.birth_month, m.birth_day, today),
        isClassMember: true,
      });
    }

    // Family members without accounts (skip records claimed by a profile)
    for (const family of families) {
      for (const fm of family.family_members_list) {
        if (fm.claimed_profile_id || !fm.birth_month || !fm.birth_day) continue;
        result.push({
          key: `fm-${fm.id}`,
          profileId: null,
          name: displayName(fm),
          avatarUrl: fm.avatar_url,
          initials: initials(fm),
          month: fm.birth_month,
          day: fm.birth_day,
          daysUntil: daysUntilNextOccurrence(fm.birth_month, fm.birth_day, today),
          isClassMember: fm.is_class_member,
        });
      }
    }

    return result;
  }, [members, families, today]);

  const byMonth = useMemo(() => {
    const filtered = includeNonClassMembers
      ? entries
      : entries.filter((e) => e.isClassMember);
    const map: Record<number, BirthdayEntry[]> = {};
    for (const e of filtered) {
      (map[e.month] ??= []).push(e);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.day - b.day);
    }
    return map;
  }, [entries, includeNonClassMembers]);

  const months = monthCycle(currentMonth).filter((m) => byMonth[m]?.length);

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <BackLink href={directoryHref}>Back to Directory</BackLink>
      <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight text-foreground mt-4 mb-6">
        Birthdays
      </h1>

      {loading ? (
        <DirectoryListSkeleton />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6">
            <Switch
              id="include-family"
              checked={includeNonClassMembers}
              onCheckedChange={setIncludeNonClassMembers}
            />
            <Label
              htmlFor="include-family"
              className="text-base text-muted-foreground cursor-pointer"
            >
              Include all family members
            </Label>
          </div>

          {months.length === 0 ? (
            <p className="text-base text-muted-foreground py-8 text-center">
              No birthdays on record yet.
            </p>
          ) : (
            months.map((month) => (
              <div key={month}>
                <DirSectionLabel>
                  {MONTH_NAMES[month - 1]}
                  {month === currentMonth && " — this month"}
                </DirSectionLabel>
                <div className="space-y-2.5">
                  {byMonth[month].map((entry) => {
                    const soon = entry.daysUntil <= 7;
                    return (
                      <DirRow
                        key={entry.key}
                        href={
                          entry.profileId
                            ? `${directoryHref}/families?person=${entry.profileId}`
                            : undefined
                        }
                        highlight={soon}
                        avatar={
                          <Avatar className="h-12 w-12">
                            {entry.avatarUrl && (
                              <AvatarImage src={entry.avatarUrl} alt={entry.name} />
                            )}
                            <AvatarFallback className="bg-brand-primary text-white">
                              {entry.initials}
                            </AvatarFallback>
                          </Avatar>
                        }
                        title={entry.name}
                        subtitle={formatNextOccurrence(entry.month, entry.day, today)}
                        trailing={
                          soon ? (
                            <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-brand-accent bg-brand-bg-light px-3.5 py-1 text-sm font-semibold text-brand-accent-text">
                              <Cake className="h-4 w-4" aria-hidden="true" />
                              {formatDaysUntil(entry.daysUntil)}
                            </span>
                          ) : undefined
                        }
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
