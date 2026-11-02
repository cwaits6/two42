"use client";

import { Suspense, useMemo, useState } from "react";
import { Cake } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DirRow } from "@/components/directory/DirRow";
import { CelebrationList } from "@/components/directory/CelebrationList";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { birthdayEntries } from "@/components/directory/celebrations";
import {
  daysUntilNextOccurrence,
  formatDaysUntil,
  formatOccurrence,
} from "@/components/directory/utils";

function BirthdaysTabInner() {
  const { members, families, basePath, today } = useDirectory();
  const [includeNonAttendees, setIncludeNonAttendees] = useState(false);

  const entries = useMemo(
    () => birthdayEntries(members, families, includeNonAttendees),
    [members, families, includeNonAttendees],
  );

  return (
    <>
      <CelebrationList
        path="/birthdays"
        noun="birthdays"
        icon={Cake}
        entries={entries}
        renderRow={(entry, soon) => (
          <DirRow
            key={entry.key}
            href={`${basePath}${entry.path}`}
            highlight={soon}
            stackTrailing
            avatar={
              <Avatar className="h-12 w-12">
                {entry.avatarUrl && <AvatarImage src={entry.avatarUrl} alt={entry.name} />}
                <AvatarFallback className="bg-brand-primary text-white">
                  {entry.initials}
                </AvatarFallback>
              </Avatar>
            }
            title={entry.name}
            subtitle={formatOccurrence(entry.month, entry.day, today)}
            trailing={
              soon ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-accent bg-brand-bg-light px-3.5 py-1 text-sm font-semibold text-brand-accent-text">
                  <Cake className="h-4 w-4" aria-hidden="true" />
                  {formatDaysUntil(daysUntilNextOccurrence(entry.month, entry.day, today))}
                </span>
              ) : undefined
            }
          />
        )}
      />

      <div className="mt-8 flex items-center gap-2">
        <Switch
          id="include-non-attendees"
          checked={includeNonAttendees}
          onCheckedChange={setIncludeNonAttendees}
        />
        <Label htmlFor="include-non-attendees" className="cursor-pointer text-base text-foreground">
          Also show household members who don&apos;t attend a group
        </Label>
      </div>
    </>
  );
}

export function BirthdaysTab() {
  return (
    <DirectoryLoadState>
      <Suspense fallback={null}>
        <BirthdaysTabInner />
      </Suspense>
    </DirectoryLoadState>
  );
}
