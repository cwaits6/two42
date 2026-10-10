"use client";

import { useState } from "react";
import { BackLink } from "@/components/directory/BackLink";
import { DirRow } from "@/components/directory/DirRow";
import { GroupCard } from "@/components/directory/GroupCard";
import { GroupIcon } from "@/components/directory/GroupIcon";
import { PersonCard } from "@/components/directory/PersonCard";
import { useDirectoryData } from "@/components/directory/useDirectoryData";
import { useDirectoryHref } from "@/components/directory/useDirectoryHref";
import { DirectoryListSkeleton } from "@/components/directory/DirectoryListSkeleton";
import type { DirectoryGroup } from "@/components/directory/types";
import type { DirectoryProfile } from "@/lib/types";

type Panel =
  | { kind: "group"; group: DirectoryGroup }
  | { kind: "person"; profile: DirectoryProfile; fromGroup: DirectoryGroup };

export default function GroupsPage() {
  const { groups, loading, familyMap, groupRosters } = useDirectoryData();
  const directoryHref = useDirectoryHref();
  const [panel, setPanel] = useState<Panel | null>(null);

  function openPanel(next: Panel) {
    setPanel(next);
    window.scrollTo({ top: 0 });
  }

  const selectedGroupId =
    panel?.kind === "group" ? panel.group.id : panel?.kind === "person" ? panel.fromGroup.id : undefined;

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <BackLink href={directoryHref}>Back to Directory</BackLink>
      <h1 className="font-serif text-4xl md:text-5xl font-medium tracking-tight text-foreground mt-4 mb-6">
        Groups
      </h1>

      {loading ? (
        <DirectoryListSkeleton />
      ) : groups.length === 0 ? (
        <p className="text-base text-muted-foreground py-8 text-center">
          No groups have been created yet.
        </p>
      ) : (
        <div className="grid gap-7 lg:grid-cols-[380px_1fr] lg:items-start">
          {/* Group list — hidden on mobile while a panel is open */}
          <div className={`space-y-2.5 ${panel ? "hidden lg:block" : ""}`}>
            {groups.map((g) => {
              const count = (groupRosters[g.id] || []).length;
              return (
                <DirRow
                  key={g.id}
                  onClick={() => openPanel({ kind: "group", group: g })}
                  selected={g.id === selectedGroupId}
                  avatar={
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: g.color || "var(--color-brand-neutral)" }}
                    >
                      <GroupIcon name={g.icon} className="h-6 w-6" />
                    </span>
                  }
                  title={g.name}
                  subtitle={`${count} member${count !== 1 ? "s" : ""}`}
                />
              );
            })}
          </div>

          {/* Detail panel */}
          <div className={panel ? "" : "hidden lg:block"}>
            {panel ? (
              <div className="rounded-xl border border-border bg-card p-6 md:p-7">
                {panel.kind === "group" ? (
                  <>
                    <BackLink onClick={() => setPanel(null)} className="mb-4">
                      Back to the list
                    </BackLink>
                    <GroupCard
                      group={panel.group}
                      members={groupRosters[panel.group.id] || []}
                      onOpenPerson={(profile) =>
                        openPanel({ kind: "person", profile, fromGroup: panel.group })
                      }
                    />
                  </>
                ) : (
                  <>
                    <BackLink
                      onClick={() => setPanel({ kind: "group", group: panel.fromGroup })}
                      className="mb-4"
                    >
                      Back to {panel.fromGroup.name}
                    </BackLink>
                    <PersonCard
                      profile={panel.profile}
                      family={
                        panel.profile.family_id
                          ? (familyMap[panel.profile.family_id] ?? null)
                          : null
                      }
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-base text-muted-foreground">
                  Choose a group from the list to see who&apos;s in it.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
