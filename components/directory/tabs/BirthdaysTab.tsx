"use client";

import { useMemo, useState } from "react";
import { Cake } from "lucide-react";
import { EmptyState } from "@/components/states/EmptyState";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { displayName, initials } from "@/lib/names";
import { DirRow, DirSection } from "@/components/directory/DirRow";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
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
  /** False for a household member without an account who doesn't attend a group */
  attendsGroup: boolean;
}

function BirthdaysTabInner() {
  const { members, families, basePath } = useDirectory();
  const [includeNonAttendees, setIncludeNonAttendees] = useState(false);

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
        attendsGroup: true,
      });
    }

    // Household members without accounts (skip records claimed by a profile)
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
          attendsGroup: fm.is_class_member,
        });
      }
    }

    return result;
  }, [members, families, today]);

  const byMonth = useMemo(() => {
    const filtered = includeNonAttendees ? entries : entries.filter((e) => e.attendsGroup);
    const map: Record<number, BirthdayEntry[]> = {};
    for (const e of filtered) {
      (map[e.month] ??= []).push(e);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => a.day - b.day);
    }
    return map;
  }, [entries, includeNonAttendees]);

  const months = monthCycle(currentMonth).filter((m) => byMonth[m]?.length);

  return (
    <>
      <div className="mb-6 flex items-center gap-2">
        <Switch
          id="include-non-attendees"
          checked={includeNonAttendees}
          onCheckedChange={setIncludeNonAttendees}
        />
        <Label htmlFor="include-non-attendees" className="cursor-pointer text-base text-foreground">
          Also show household members who don&apos;t attend a group
        </Label>
      </div>

      {months.length === 0 ? (
        <EmptyState icon={Cake} message="No birthdays on record yet." />
      ) : (
        months.map((month) => (
          <DirSection
            key={month}
            label={`${MONTH_NAMES[month - 1]}${month === currentMonth ? " — this month" : ""}`}
          >
            {byMonth[month].map((entry) => {
              const soon = entry.daysUntil <= 7;
              return (
                <DirRow
                  key={entry.key}
                  href={
                    entry.profileId ? `${basePath}/families?person=${entry.profileId}` : undefined
                  }
                  highlight={soon}
                  avatar={
                    <Avatar className="h-12 w-12">
                      {entry.avatarUrl && <AvatarImage src={entry.avatarUrl} alt={entry.name} />}
                      <AvatarFallback className="bg-brand-primary text-white">
                        {entry.initials}
                      </AvatarFallback>
                    </Avatar>
                  }
                  title={entry.name}
                  subtitle={formatNextOccurrence(entry.month, entry.day, today)}
                  trailing={
                    soon ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-accent bg-brand-bg-light px-3.5 py-1 text-sm font-semibold text-brand-accent-text">
                        <Cake className="h-4 w-4" aria-hidden="true" />
                        {formatDaysUntil(entry.daysUntil)}
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </DirSection>
        ))
      )}
    </>
  );
}

export function BirthdaysTab() {
  return (
    <DirectoryLoadState>
      <BirthdaysTabInner />
    </DirectoryLoadState>
  );
}
