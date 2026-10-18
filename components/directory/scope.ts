// The directory scope model: which people the list shows, and which scope
// options the viewer may pick. Pure, so every rule is testable without
// React or Supabase. RLS already narrows what the viewer may read; the
// scope only filters within that.

export type DirectoryScope =
  | { kind: "group"; groupId: string }
  | { kind: "mine" }
  | { kind: "org" };

export interface ScopeOption {
  value: string;
  label: string;
  scope: DirectoryScope;
}

export type ScopeMembership = { id: string; name: string };

/** Profile ids per group, for every group the viewer belongs to. */
export type GroupRosters = Record<string, ReadonlySet<string>>;

export function scopeValue(scope: DirectoryScope): string {
  return scope.kind === "group" ? `group:${scope.groupId}` : scope.kind;
}

/**
 * The scope options in display order. Inside a group: this group, each
 * other group, all my groups, then everyone when the org allows it. At the
 * org level: all my groups, each group, then everyone. The control is
 * omitted when it would offer one option, so a one-group org with the
 * setting off sees no control at all.
 */
export function directoryScopeOptions(input: {
  memberships: ScopeMembership[];
  activeGroupId: string | null;
  orgVisible: boolean;
  orgName: string;
}): { options: ScopeOption[]; defaultScope: DirectoryScope; showControl: boolean } {
  const { memberships, activeGroupId, orgVisible, orgName } = input;
  const options: ScopeOption[] = [];
  const groupOption = (g: ScopeMembership, label = g.name): ScopeOption => ({
    value: `group:${g.id}`,
    label,
    scope: { kind: "group", groupId: g.id },
  });
  const mine: ScopeOption = { value: "mine", label: "All my groups", scope: { kind: "mine" } };

  // With one membership "All my groups" and that group are the same set,
  // so only one of them is offered; with none, "All my groups" is the one.
  const several = memberships.length > 1;
  if (activeGroupId) {
    const active = memberships.find((g) => g.id === activeGroupId);
    if (active) options.push(groupOption(active, "This group"));
    for (const g of memberships) {
      if (g.id !== activeGroupId) options.push(groupOption(g));
    }
    if (several) options.push(mine);
  } else {
    options.push(mine);
    if (several) for (const g of memberships) options.push(groupOption(g));
  }
  if (orgVisible) {
    options.push({ value: "org", label: `Everyone in ${orgName}`, scope: { kind: "org" } });
  }

  const defaultScope: DirectoryScope = activeGroupId
    ? { kind: "group", groupId: activeGroupId }
    : { kind: "mine" };
  return { options, defaultScope, showControl: options.length > 1 };
}

export function inScope(
  scope: DirectoryScope,
  profileId: string,
  rosters: GroupRosters,
  membershipIds: readonly string[]
): boolean {
  switch (scope.kind) {
    case "group":
      return rosters[scope.groupId]?.has(profileId) ?? false;
    case "mine":
      return membershipIds.some((id) => rosters[id]?.has(profileId));
    case "org":
      return true;
  }
}

export function scopeMembers<T extends { id: string }>(
  members: readonly T[],
  scope: DirectoryScope,
  rosters: GroupRosters,
  membershipIds: readonly string[]
): T[] {
  return members.filter((m) => inScope(scope, m.id, rosters, membershipIds));
}

/** A household is in scope when any of its account-holding members is. */
export function scopeFamilies<T extends { members: readonly { id: string }[] }>(
  families: readonly T[],
  scope: DirectoryScope,
  rosters: GroupRosters,
  membershipIds: readonly string[]
): T[] {
  if (scope.kind === "org") return [...families];
  return families.filter((f) => f.members.some((m) => inScope(scope, m.id, rosters, membershipIds)));
}

/** True for a person the viewer can read only because the org opened its directory. */
export function outsideMyGroups(
  scope: DirectoryScope,
  profileId: string,
  rosters: GroupRosters,
  membershipIds: readonly string[]
): boolean {
  return scope.kind === "org" && !inScope({ kind: "mine" }, profileId, rosters, membershipIds);
}
