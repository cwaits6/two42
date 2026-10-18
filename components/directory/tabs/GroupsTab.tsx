"use client";

import { useState } from "react";
import { useDiscoveryOn } from "@/components/groups/GroupProvider";
import { groupInitials, type ActiveGroup } from "@/lib/groups/active";
import { BackLink } from "@/components/directory/BackLink";
import { DirRow } from "@/components/directory/DirRow";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { GroupCard } from "@/components/directory/GroupCard";
import { PersonCard } from "@/components/directory/PersonCard";
import { TwoPane, scrollToPanel } from "@/components/directory/TwoPane";
import type { DirectoryProfile } from "@/lib/types";

type Panel =
  | { kind: "group"; group: ActiveGroup }
  | { kind: "person"; profile: DirectoryProfile; fromGroup: ActiveGroup };

/**
 * The org's groups. Until discovery lands this is the viewer's own groups
 * only; the scope control above does not apply, since this tab lists
 * groups rather than people.
 */
function GroupsTabInner() {
  const { memberships, groupRosters, profileMap, familyMap, orgName } = useDirectory();
  const discoveryOn = useDiscoveryOn();
  const [panel, setPanel] = useState<Panel | null>(null);

  function openPanel(next: Panel) {
    setPanel(next);
    scrollToPanel();
  }

  const roster = (group: ActiveGroup): DirectoryProfile[] =>
    [...(groupRosters[group.id] ?? [])]
      .map((id) => profileMap[id])
      .filter((p): p is DirectoryProfile => Boolean(p))
      .sort((a, b) => (a.last_name ?? "").localeCompare(b.last_name ?? ""));

  const selectedGroupId =
    panel?.kind === "group" ? panel.group.id : panel?.kind === "person" ? panel.fromGroup.id : undefined;

  if (memberships.length === 0) {
    return (
      <p className="py-8 text-center text-base text-muted-foreground">You are not in a group yet.</p>
    );
  }

  return (
    <>
      <TwoPane
        list={
          <div className="space-y-2.5">
            {memberships.map((g) => {
              const count = roster(g).length;
              return (
                <DirRow
                  key={g.id}
                  onClick={() => openPanel({ kind: "group", group: g })}
                  selected={g.id === selectedGroupId}
                  avatar={
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-full font-bold text-white"
                      style={{ backgroundColor: g.color }}
                    >
                      {groupInitials(g.name)}
                    </span>
                  }
                  title={g.name}
                  subtitle={`${count} member${count !== 1 ? "s" : ""}`}
                />
              );
            })}
          </div>
        }
        panel={
          panel ? (
            panel.kind === "group" ? (
              <>
                <BackLink onClick={() => setPanel(null)} className="mb-4">
                  Back to the list
                </BackLink>
                <GroupCard
                  group={panel.group}
                  members={roster(panel.group)}
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
                    panel.profile.family_id ? (familyMap[panel.profile.family_id] ?? null) : null
                  }
                />
              </>
            )
          ) : null
        }
        placeholder="Choose a group from the list to see who's in it."
      />
      {!discoveryOn && (
        <p className="mt-6 text-base text-muted-foreground">
          {orgName} does not list other groups here. To join one, ask its leader to add you.
        </p>
      )}
    </>
  );
}

export function GroupsTab() {
  return (
    <DirectoryLoadState>
      <GroupsTabInner />
    </DirectoryLoadState>
  );
}
