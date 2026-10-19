"use client";

import { useDirectory } from "@/components/directory/DirectoryContext";
import { outsideMyGroups } from "@/components/directory/scope";

/**
 * The groups a person shares with the viewer, one small chip each, shown
 * on a row whenever the scope spans groups. The name is always in text;
 * the colour dot is never the only carrier. Under the org-wide scope a
 * person who shares no group gets a plain note instead.
 */
export function GroupChips({ profileId }: { profileId: string }) {
  const { scope, memberships, groupsByProfile, groupRosters } = useDirectory();
  if (scope.kind === "group") return null;

  const membershipIds = memberships.map((g) => g.id);
  if (outsideMyGroups(scope, profileId, groupRosters, membershipIds)) {
    return <span className="shrink-0 text-sm text-muted-foreground">Not in any of your groups</span>;
  }

  const shared = new Set(groupsByProfile[profileId] ?? []);
  const groups = memberships.filter((g) => shared.has(g.id));
  if (groups.length === 0) return null;

  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {groups.map((g) => (
        <span
          key={g.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-sm font-medium text-foreground"
        >
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: g.color }}
            aria-hidden="true"
          />
          {g.name}
        </span>
      ))}
    </span>
  );
}
