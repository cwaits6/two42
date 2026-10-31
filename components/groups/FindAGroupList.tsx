"use client";

import { Users } from "lucide-react";
import { DirRow } from "@/components/directory/DirRow";
import { GroupAvatar } from "@/components/directory/GroupAvatar";
import { ErrorState } from "@/components/states/ErrorState";
import { groupColor } from "@/components/directory/groupColor";
import { GroupJoinAction } from "@/components/groups/GroupJoinAction";
import { useGroupMemberships } from "@/components/groups/GroupProvider";
import { useDiscoverableGroups } from "@/components/groups/useDiscoverableGroups";
import { EmptyState } from "@/components/states/EmptyState";
import { discoveryRowSubtitle, type DiscoverableGroup } from "@/lib/groups/joining";

export const NO_GROUPS_TEXT = "No groups are open to join yet.";

/** One discovery row: name, member count and meeting time, then the viewer's standing or action. */
export function DiscoveryRow({ row, onChanged }: { row: DiscoverableGroup; onChanged: () => void }) {
  const memberships = useGroupMemberships();
  return (
    <DirRow
      avatar={<GroupAvatar name={row.name} color={groupColor(row.id, memberships)} />}
      title={row.name}
      subtitle={discoveryRowSubtitle(row)}
      trailing={<GroupJoinAction row={row} onChanged={onChanged} />}
      stackTrailing
    />
  );
}

/** The /find-a-group list, seeded with the rows the page loaded. */
export function FindAGroupList({ initialRows }: { initialRows: DiscoverableGroup[] }) {
  const { rows, error, reload } = useDiscoverableGroups(initialRows);

  if (error) {
    return <ErrorState thing="groups to join" onRetry={reload} />;
  }
  if (rows.length === 0) {
    return <EmptyState icon={Users} message={NO_GROUPS_TEXT} />;
  }
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.id}>
          <DiscoveryRow row={row} onChanged={reload} />
        </li>
      ))}
    </ul>
  );
}
