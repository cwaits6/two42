"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { displayName, initials } from "@/lib/names";
import { formatPhone } from "@/lib/sanitize";
import { BackLink } from "@/components/directory/BackLink";
import { DirRow, DirSectionLabel } from "@/components/directory/DirRow";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { GroupChips } from "@/components/directory/GroupChips";
import { PersonCard } from "@/components/directory/PersonCard";
import { TwoPane, scrollToPanel } from "@/components/directory/TwoPane";
import type { DirectoryProfile } from "@/lib/types";

function sortKey(m: DirectoryProfile): string {
  return `${m.last_name ?? ""} ${m.preferred_name ?? m.first_name ?? ""}`.trim().toLowerCase();
}

function matchesQuery(m: DirectoryProfile, q: string): boolean {
  return [m.first_name, m.last_name, m.preferred_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function MembersTabInner() {
  const { members, memberships, profileMap, familyMap } = useDirectory();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DirectoryProfile | null>(null);
  const personParam = useSearchParams().get("person");

  useEffect(() => {
    if (personParam && profileMap[personParam]) setSelected(profileMap[personParam]);
  }, [personParam, profileMap]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = members.filter((m) => !q || matchesQuery(m, q));
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const map: Record<string, DirectoryProfile[]> = {};
    for (const m of list) {
      const first = (m.last_name || m.first_name || "#").charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      (map[letter] ??= []).push(m);
    }
    return map;
  }, [members, query]);
  const letters = Object.keys(sections).sort();

  function openPerson(profile: DirectoryProfile) {
    setSelected(profile);
    scrollToPanel();
  }

  const emptyMessage =
    memberships.length === 0
      ? "You are not in a group yet."
      : query
        ? "No members match your search."
        : "No members to show.";

  return (
    <TwoPane
      above={
        <div className="relative mb-7">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name"
            aria-label="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-13 rounded-xl pl-12 text-base"
          />
        </div>
      }
      list={
        letters.length === 0 ? (
          <p className="py-8 text-center text-base text-muted-foreground">{emptyMessage}</p>
        ) : (
          letters.map((letter) => (
            <div key={letter}>
              <DirSectionLabel>{letter}</DirSectionLabel>
              <div className="space-y-2.5">
                {sections[letter].map((m) => (
                  <DirRow
                    key={m.id}
                    onClick={() => openPerson(m)}
                    selected={selected?.id === m.id}
                    avatar={
                      <Avatar className="h-12 w-12">
                        {m.avatar_url && <AvatarImage src={m.avatar_url} alt={displayName(m)} />}
                        <AvatarFallback className="bg-brand-primary text-white">
                          {initials(m)}
                        </AvatarFallback>
                      </Avatar>
                    }
                    title={displayName(m)}
                    subtitle={m.phone_mobile ? formatPhone(m.phone_mobile) : undefined}
                    trailing={<GroupChips profileId={m.id} />}
                  />
                ))}
              </div>
            </div>
          ))
        )
      }
      panel={
        selected ? (
          <>
            <BackLink onClick={() => setSelected(null)} className="mb-4">
              Back to the list
            </BackLink>
            <PersonCard
              profile={selected}
              family={selected.family_id ? (familyMap[selected.family_id] ?? null) : null}
            />
          </>
        ) : null
      }
      placeholder="Choose a person from the list to see their details."
    />
  );
}

export function MembersTab() {
  return (
    <DirectoryLoadState>
      <Suspense fallback={null}>
        <MembersTabInner />
      </Suspense>
    </DirectoryLoadState>
  );
}
