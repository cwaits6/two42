"use client";

import { Suspense, useMemo } from "react";
import { Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DirRow } from "@/components/directory/DirRow";
import { CelebrationList } from "@/components/directory/CelebrationList";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { anniversaryEntries } from "@/components/directory/celebrations";
import { formatOccurrence } from "@/components/directory/utils";

function AnniversariesTabInner() {
  const { families, today } = useDirectory();

  const entries = useMemo(() => anniversaryEntries(families, today), [families, today]);

  return (
    <CelebrationList
      tab="anniversaries"
      noun="anniversaries"
      icon={Heart}
      entries={entries}
      renderRow={(entry, soon, href) => (
        <DirRow
          key={entry.key}
          href={href(entry.path)}
          highlight={soon}
          stackTrailing
          avatar={
            <Avatar className="h-12 w-12">
              {entry.photoUrl && <AvatarImage src={entry.photoUrl} alt={entry.coupleName} />}
              <AvatarFallback className="bg-brand-primary text-white">
                {entry.initial}
              </AvatarFallback>
            </Avatar>
          }
          title={entry.coupleName}
          subtitle={formatOccurrence(entry.month, entry.day, today)}
          below={
            entry.marriedYear !== null ? (
              <span className="block text-base text-muted-foreground">Married {entry.marriedYear}</span>
            ) : undefined
          }
          trailing={
            soon && entry.years !== null ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-accent bg-brand-bg-light px-3.5 py-1 text-sm font-semibold text-brand-accent-text">
                <Heart className="h-4 w-4" aria-hidden="true" />
                {entry.years} years
              </span>
            ) : undefined
          }
        />
      )}
    />
  );
}

export function AnniversariesTab() {
  return (
    <DirectoryLoadState>
      <Suspense fallback={null}>
        <AnniversariesTabInner />
      </Suspense>
    </DirectoryLoadState>
  );
}
