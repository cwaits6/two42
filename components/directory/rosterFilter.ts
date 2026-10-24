// The roster filter: which people a chosen set of teams and labels keeps.
// Pure, so the AND rule and the bulk-label state are testable without
// React or Supabase.

export interface RosterFilter {
  teamIds: ReadonlySet<string>;
  labelIds: ReadonlySet<string>;
}

export const EMPTY_FILTER: RosterFilter = { teamIds: new Set(), labelIds: new Set() };

export interface RosterIndex {
  /** Profile id → the team ids the person is on, within the scoped group. */
  teamsByProfile: ReadonlyMap<string, ReadonlySet<string>>;
  /** Profile id → the label ids applied to that person's membership. */
  labelsByProfile: ReadonlyMap<string, ReadonlySet<string>>;
}

export function isEmptyFilter(filter: RosterFilter): boolean {
  return filter.teamIds.size === 0 && filter.labelIds.size === 0;
}

function hasEvery(selected: ReadonlySet<string>, owned: ReadonlySet<string> | undefined): boolean {
  if (selected.size === 0) return true;
  if (!owned) return false;
  for (const id of selected) if (!owned.has(id)) return false;
  return true;
}

/** Every selected team and every selected label must apply (AND). */
export function matchesRosterFilter(
  profileId: string,
  filter: RosterFilter,
  index: RosterIndex,
): boolean {
  return (
    hasEvery(filter.teamIds, index.teamsByProfile.get(profileId)) &&
    hasEvery(filter.labelIds, index.labelsByProfile.get(profileId))
  );
}

export function applyRosterFilter<T extends { id: string }>(
  people: readonly T[],
  filter: RosterFilter,
  index: RosterIndex,
): T[] {
  if (isEmptyFilter(filter)) return [...people];
  return people.filter((p) => matchesRosterFilter(p.id, filter, index));
}

export function toggleInSet(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** "Filter" when nothing is selected, else "{n} selected" counting teams plus labels. */
export function filterButtonLabel(filter: RosterFilter): string {
  const n = filter.teamIds.size + filter.labelIds.size;
  return n === 0 ? "Filter" : `${n} selected`;
}

/** The bulk bar's checkbox state for one label over the selected people. */
export function bulkLabelState(
  selectedProfileIds: ReadonlySet<string>,
  labelId: string,
  index: RosterIndex,
): "all" | "some" | "none" {
  if (selectedProfileIds.size === 0) return "none";
  let withLabel = 0;
  for (const id of selectedProfileIds) {
    if (index.labelsByProfile.get(id)?.has(labelId)) withLabel++;
  }
  if (withLabel === 0) return "none";
  return withLabel === selectedProfileIds.size ? "all" : "some";
}
