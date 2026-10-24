"use client";

import { useState } from "react";
import { useDiscoveryOn } from "@/components/groups/GroupProvider";
import { CreateGroupAction } from "@/components/groups/CreateGroupAction";
import { DiscoveryRow, LOAD_FAILED_TEXT, NO_GROUPS_TEXT } from "@/components/groups/FindAGroupList";
import { useDiscoverableGroups } from "@/components/groups/useDiscoverableGroups";
import { groupInitials, type ActiveGroup } from "@/lib/groups/active";
import { memberCountLabel, type DiscoverableGroup } from "@/lib/groups/joining";
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

/** A row of the list: one of the viewer's groups (opens its roster) or a group to join. */
type ListRow =
  | { kind: "own"; group: ActiveGroup; count: number; role: ActiveGroup["role"] }
  | { kind: "other"; row: DiscoverableGroup };

/**
 * The org's groups: the viewer's own groups first, each opening its roster
 * in the panel, then the groups discoverable_groups() lets them see with a
 * join action. Until that read lands (or if it fails) the viewer's own
 * groups render from the memberships alone. The scope control above does
 * not apply, since this tab lists groups rather than people.
 */
function GroupsTabInner() {
  const { memberships, groupRosters, profileMap, familyMap, orgName, reload: reloadDirectory } =
    useDirectory();
  const discoveryOn = useDiscoveryOn();
  const discovery = useDiscoverableGroups();
  const [panel, setPanel] = useState<Panel | null>(null);

  function openPanel(next: Panel) {
    setPanel(next);
    scrollToPanel();
  }

  function onChanged() {
    discovery.reload();
    reloadDirectory();
  }

  const roster = (group: ActiveGroup): DirectoryProfile[] =>
    [...(groupRosters[group.id] ?? [])]
      .map((id) => profileMap[id])
      .filter((p): p is DirectoryProfile => Boolean(p))
      .sort((a, b) => (a.last_name ?? "").localeCompare(b.last_name ?? ""));

  const discoveryReady = !discovery.loading && !discovery.error;
  const listRows: ListRow[] = discoveryReady
    ? discovery.rows.map((row) => {
        const own = row.viewer_role ? memberships.find((g) => g.id === row.id) : undefined;
        return own
          ? { kind: "own", group: own, count: row.member_count, role: own.role }
          : { kind: "other", row };
      })
    : memberships.map((g) => ({ kind: "own", group: g, count: roster(g).length, role: g.role }));

  const selectedGroupId =
    panel?.kind === "group" ? panel.group.id : panel?.kind === "person" ? panel.fromGroup.id : undefined;

  if (listRows.length === 0) {
    return (
      <>
        <CreateGroupAction className="mb-5" />
        <p className="py-8 text-center text-base text-muted-foreground">You are not in a group yet.</p>
        {discoveryOn && discoveryReady && (
          <p className="text-center text-base text-muted-foreground">{NO_GROUPS_TEXT}</p>
        )}
      </>
    );
  }

  return (
    <>
      <CreateGroupAction className="mb-5" />
      <TwoPane
        list={
          <ul className="space-y-2.5">
            {listRows.map((item) => (
              <li key={item.kind === "own" ? item.group.id : item.row.id}>
                {item.kind === "own" ? (
                  <DirRow
                    onClick={() => openPanel({ kind: "group", group: item.group })}
                    selected={item.group.id === selectedGroupId}
                    avatar={
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-full font-bold text-white"
                        style={{ backgroundColor: item.group.color }}
                      >
                        {groupInitials(item.group.name)}
                      </span>
                    }
                    title={item.group.name}
                    subtitle={memberCountLabel(item.count)}
                    trailing={
                      <span className="shrink-0 text-base font-semibold text-muted-foreground">
                        {item.role === "leader" ? "You lead this group" : "You are a member"}
                      </span>
                    }
                  />
                ) : (
                  <DiscoveryRow row={item.row} onChanged={onChanged} />
                )}
              </li>
            ))}
          </ul>
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
        placeholder="Choose one of your groups to see who's in it."
      />
      {discoveryOn && discovery.error && (
        <p role="alert" className="mt-6 text-base text-muted-foreground">
          {LOAD_FAILED_TEXT}
        </p>
      )}
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
