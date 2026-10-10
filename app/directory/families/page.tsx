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
import { FamilyCard } from "@/components/directory/FamilyCard";
import { PersonCard } from "@/components/directory/PersonCard";
import { useDirectoryData } from "@/components/directory/useDirectoryData";
import { useDirectoryHref } from "@/components/directory/useDirectoryHref";
import { DirectoryListSkeleton } from "@/components/directory/DirectoryListSkeleton";
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

function FamiliesPageInner() {
  const { members, families, loading, profileMap, familyMap } = useDirectoryData();
  const directoryHref = useDirectoryHref();
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const searchParams = useSearchParams();

  // Deep links: ?family=<id> opens a household, ?person=<id> opens a person
  const familyParam = searchParams.get("family");
  const personParam = searchParams.get("person");
  useEffect(() => {
    if (loading) return;
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
  }, [loading, familyParam, personParam, profileMap, familyMap]);

  // Households plus members without a family, filtered by search
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
    // On mobile the panel replaces the list — bring it into view
    window.scrollTo({ top: 0 });
  }

  const selectedFamilyId =
    panel?.kind === "family"
      ? panel.family.id
      : panel?.kind === "person"
        ? panel.fromFamily?.id
        : undefined;

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <BackLink href={directoryHref}>Back to Directory</BackLink>
      <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight text-foreground mt-4 mb-6">
        Families
      </h1>

      {loading ? (
        <DirectoryListSkeleton />
      ) : (
        <>
          {/* Search */}
          <div className={`relative mb-7 ${panel ? "hidden lg:block" : ""}`}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name"
              aria-label="Search families"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 h-13 text-base rounded-xl"
            />
          </div>

          <div className="grid gap-7 lg:grid-cols-[380px_1fr] lg:items-start">
            {/* A–Z list — hidden on mobile while a panel is open */}
            <div className={panel ? "hidden lg:block" : ""}>
              {entries.length === 0 ? (
                <p className="text-base text-muted-foreground py-8 text-center">
                  No members match your search.
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
                              selected={
                                panel?.kind === "person" && panel.profile.id === entry.member.id
                              }
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
              )}
            </div>

            {/* Detail panel */}
            <div className={panel ? "" : "hidden lg:block"}>
              {panel ? (
                <div className="rounded-xl border border-border bg-card p-6 md:p-7">
                  {panel.kind === "family" ? (
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
                            panel.fromFamily
                              ? { kind: "family", family: panel.fromFamily }
                              : null,
                          )
                        }
                        className="mb-4"
                      >
                        {panel.fromFamily
                          ? `Back to ${panel.fromFamily.family_name}`
                          : "Back to the list"}
                      </BackLink>
                      <PersonCard
                        profile={panel.profile}
                        family={
                          panel.fromFamily ??
                          (panel.profile.family_id
                            ? (familyMap[panel.profile.family_id] ?? null)
                            : null)
                        }
                      />
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <p className="text-base text-muted-foreground">
                    Choose a family from the list to see their details.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FamiliesPage() {
  return (
    <Suspense fallback={null}>
      <FamiliesPageInner />
    </Suspense>
  );
}
