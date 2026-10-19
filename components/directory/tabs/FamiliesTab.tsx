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
import { FamilyCard } from "@/components/directory/FamilyCard";
import { PersonCard } from "@/components/directory/PersonCard";
import { TwoPane, scrollToPanel } from "@/components/directory/TwoPane";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

type Panel =
  | { kind: "family"; family: FamilyDirectoryFull }
  | { kind: "person"; profile: DirectoryProfile; fromFamily: FamilyDirectoryFull | null };

type ListEntry =
  | { kind: "family"; family: FamilyDirectoryFull }
  | { kind: "solo"; member: DirectoryProfile };

/** "Tom & Linda" — adult first names for the household row subtitle */
function adultNames(family: FamilyDirectoryFull): string {
  const primary = family.members.find((m) => m.relationship === "primary");
  const spouse =
    family.members.find((m) => m.relationship === "spouse") ||
    family.family_members_list.find((fm) => fm.relationship === "spouse");
  return [primary, spouse]
    .filter(Boolean)
    .map((p) => p!.preferred_name || p!.first_name)
    .filter(Boolean)
    .join(" & ");
}

function FamiliesTabInner() {
  const { members, families, memberships, profileMap, familyMap } = useDirectory();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const searchParams = useSearchParams();

  // Deep links: ?family=<id> opens a household, ?person=<id> opens a person
  const familyParam = searchParams.get("family");
  const personParam = searchParams.get("person");
  useEffect(() => {
    if (personParam && profileMap[personParam]) {
      const profile = profileMap[personParam];
      setPanel({
        kind: "person",
        profile,
        fromFamily: profile.family_id ? (familyMap[profile.family_id] ?? null) : null,
      });
    } else if (familyParam && familyMap[familyParam]) {
      setPanel({ kind: "family", family: familyMap[familyParam] });
    }
  }, [familyParam, personParam, profileMap, familyMap]);

  // Households plus members without a family, within the scope, filtered by search
  const entries = useMemo<ListEntry[]>(() => {
    const q = query.trim().toLowerCase();

    const matchesProfile = (m: DirectoryProfile) =>
      [m.first_name, m.last_name, m.preferred_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);

    const matchesFamily = (f: FamilyDirectoryFull) =>
      !q ||
      f.family_name.toLowerCase().includes(q) ||
      f.members.some(
        (m) =>
          [m.first_name, m.last_name, m.preferred_name]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
      ) ||
      f.family_members_list.some((fm) =>
        [fm.first_name, fm.last_name].filter(Boolean).join(" ").toLowerCase().includes(q),
      );

    const solos = members.filter((m) => !m.family_id && (!q || matchesProfile(m)));

    const result: ListEntry[] = [
      ...families.filter(matchesFamily).map((f) => ({ kind: "family" as const, family: f })),
      ...solos.map((m) => ({ kind: "solo" as const, member: m })),
    ];

    result.sort((a, b) => {
      const keyA =
        a.kind === "family" ? a.family.family_name : a.member.last_name || a.member.first_name || "";
      const keyB =
        b.kind === "family" ? b.family.family_name : b.member.last_name || b.member.first_name || "";
      return keyA.localeCompare(keyB);
    });
    return result;
  }, [members, families, query]);

  // Group by first letter of the sort key
  const sections = useMemo(() => {
    const map: Record<string, ListEntry[]> = {};
    for (const entry of entries) {
      const key =
        entry.kind === "family"
          ? entry.family.family_name.charAt(0).toUpperCase()
          : (entry.member.last_name || entry.member.first_name || "#").charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(key) ? key : "#";
      (map[letter] ??= []).push(entry);
    }
    return map;
  }, [entries]);

  function openPanel(next: Panel) {
    setPanel(next);
    scrollToPanel();
  }

  const selectedFamilyId =
    panel?.kind === "family"
      ? panel.family.id
      : panel?.kind === "person"
        ? panel.fromFamily?.id
        : undefined;

  return (
    <TwoPane
      above={
        <div className="relative mb-7">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name"
            aria-label="Search families"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-13 rounded-xl pl-12 text-base"
          />
        </div>
      }
      list={
        entries.length === 0 ? (
          <p className="py-8 text-center text-base text-muted-foreground">
            {memberships.length === 0
              ? "You are not in a group yet."
              : query
                ? "No families match your search."
                : "No families to show."}
          </p>
        ) : (
          Object.keys(sections)
            .sort()
            .map((letter) => (
              <div key={letter}>
                <DirSectionLabel>{letter}</DirSectionLabel>
                <div className="space-y-2.5">
                  {sections[letter].map((entry) =>
                    entry.kind === "family" ? (
                      <DirRow
                        key={`fam-${entry.family.id}`}
                        onClick={() => openPanel({ kind: "family", family: entry.family })}
                        selected={entry.family.id === selectedFamilyId}
                        avatar={
                          <Avatar className="h-12 w-12">
                            {entry.family.photo_url && (
                              <AvatarImage
                                src={entry.family.photo_url}
                                alt={`${entry.family.family_name} family photo`}
                              />
                            )}
                            <AvatarFallback className="bg-brand-primary text-white">
                              {entry.family.family_name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        }
                        title={entry.family.family_name}
                        subtitle={adultNames(entry.family) || undefined}
                      />
                    ) : (
                      <DirRow
                        key={`solo-${entry.member.id}`}
                        onClick={() =>
                          openPanel({ kind: "person", profile: entry.member, fromFamily: null })
                        }
                        selected={panel?.kind === "person" && panel.profile.id === entry.member.id}
                        avatar={
                          <Avatar className="h-12 w-12">
                            {entry.member.avatar_url && (
                              <AvatarImage
                                src={entry.member.avatar_url}
                                alt={displayName(entry.member)}
                              />
                            )}
                            <AvatarFallback className="bg-brand-primary text-white">
                              {initials(entry.member)}
                            </AvatarFallback>
                          </Avatar>
                        }
                        title={displayName(entry.member)}
                        subtitle={
                          entry.member.phone_mobile
                            ? formatPhone(entry.member.phone_mobile)
                            : undefined
                        }
                      />
                    ),
                  )}
                </div>
              </div>
            ))
        )
      }
      panel={
        panel ? (
          panel.kind === "family" ? (
            <>
              <BackLink onClick={() => setPanel(null)} className="mb-4">
                Back to the list
              </BackLink>
              <FamilyCard
                family={panel.family}
                profileMap={profileMap}
                onOpenPerson={(profile) =>
                  openPanel({ kind: "person", profile, fromFamily: panel.family })
                }
              />
            </>
          ) : (
            <>
              <BackLink
                onClick={() =>
                  setPanel(
                    panel.fromFamily ? { kind: "family", family: panel.fromFamily } : null,
                  )
                }
                className="mb-4"
              >
                {panel.fromFamily ? `Back to ${panel.fromFamily.family_name}` : "Back to the list"}
              </BackLink>
              <PersonCard
                profile={panel.profile}
                family={
                  panel.fromFamily ??
                  (panel.profile.family_id ? (familyMap[panel.profile.family_id] ?? null) : null)
                }
              />
            </>
          )
        ) : null
      }
      placeholder="Choose a family from the list to see their details."
    />
  );
}

export function FamiliesTab() {
  return (
    <DirectoryLoadState>
      <Suspense fallback={null}>
        <FamiliesTabInner />
      </Suspense>
    </DirectoryLoadState>
  );
}
