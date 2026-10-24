"use client";

import { DirRow } from "@/components/directory/DirRow";
import { GroupJoinAction } from "@/components/groups/GroupJoinAction";
import { useDiscoverableGroups } from "@/components/groups/useDiscoverableGroups";
import { groupInitials } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { discoveryRowSubtitle, type DiscoverableGroup } from "@/lib/groups/joining";

export const NO_GROUPS_TEXT = "No groups are open to join yet.";
export const LOAD_FAILED_TEXT = "Couldn't load groups to join. Reload the page to try again.";

/** One discovery row: name, member count and meeting time, then the viewer's standing or action. */
export function DiscoveryRow({ row, onChanged }: { row: DiscoverableGroup; onChanged: () => void }) {
  return (
    <DirRow
      avatar={
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full font-bold text-white"
          style={{ backgroundColor: GROUP_DEFAULT_COLOR }}
        >
          {groupInitials(row.name)}
        </span>
      }
      title={row.name}
      subtitle={discoveryRowSubtitle(row)}
      actions={<GroupJoinAction row={row} onChanged={onChanged} />}
    />
  );
}

/** The /find-a-group list, seeded with the rows the page loaded. */
export function FindAGroupList({ initialRows }: { initialRows: DiscoverableGroup[] }) {
  const { rows, error, reload } = useDiscoverableGroups(initialRows);

  if (error) {
    return (
      <p role="alert" className="text-lg text-muted-foreground">
        {LOAD_FAILED_TEXT}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-lg text-muted-foreground">{NO_GROUPS_TEXT}</p>;
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
