"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { displayName, initials } from "@/lib/names";
import { formatPhone } from "@/lib/sanitize";
import { BackLink } from "@/components/directory/BackLink";
import { DirRow, DirSectionLabel } from "@/components/directory/DirRow";
import { DirectoryLoadState } from "@/components/directory/DirectoryLoadState";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { GroupChips } from "@/components/directory/GroupChips";
import { PersonCard } from "@/components/directory/PersonCard";
import { TwoPane, scrollToPanel } from "@/components/directory/TwoPane";
import {
  EMPTY_FILTER,
  applyRosterFilter,
  bulkLabelState,
  isEmptyFilter,
  toggleInSet,
  type RosterFilter,
} from "@/components/directory/rosterFilter";
import { useGroupRoster } from "@/components/directory/useGroupRoster";
import { AddMemberPanel } from "@/components/directory/roster/AddMemberPanel";
import { BulkLabelBar } from "@/components/directory/roster/BulkLabelBar";
import { EditMemberDialog, type EditMemberChanges } from "@/components/directory/roster/EditMemberDialog";
import { LabelPills } from "@/components/directory/roster/LabelPills";
import { RemoveMemberDialog } from "@/components/directory/roster/RemoveMemberDialog";
import { RosterFilterMenu } from "@/components/directory/roster/RosterFilterMenu";
import type { DirectoryProfile } from "@/lib/types";

function sortKey(m: DirectoryProfile): string {
  return `${m.last_name ?? ""} ${m.preferred_name ?? m.first_name ?? ""}`.trim().toLowerCase();
}

function matchesQuery(m: DirectoryProfile, q: string): boolean {
  return [m.first_name, m.last_name, m.preferred_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

type Mode = "list" | "add" | "select";

const NO_LABELS: ReadonlySet<string> = new Set();

function MembersTabInner() {
  const { members, memberships, profileMap, familyMap, scope, currentUserId, orgName, reload } =
    useDirectory();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DirectoryProfile | null>(null);
  const personParam = useSearchParams().get("person");

  // The roster controls exist only at single-group scope; the scope control
  // can reach it from the org-level directory too.
  const scopedGroupId = scope.kind === "group" ? scope.groupId : null;
  const scopedGroup = memberships.find((g) => g.id === scopedGroupId) ?? null;
  const isLeader = scopedGroup?.role === "leader";
  const groupName = scopedGroup?.name ?? "this group";
  const roster = useGroupRoster(scopedGroupId);

  const [filter, setFilter] = useState<RosterFilter>(EMPTY_FILTER);
  const [mode, setMode] = useState<Mode>("list");
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<DirectoryProfile | null>(null);
  const [removing, setRemoving] = useState<DirectoryProfile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (personParam && profileMap[personParam]) setSelected(profileMap[personParam]);
  }, [personParam, profileMap]);

  useEffect(() => {
    setFilter(EMPTY_FILTER);
    setMode("list");
    setChecked(new Set());
  }, [scopedGroupId]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = members.filter((m) => !q || matchesQuery(m, q));
    if (scopedGroupId) list = applyRosterFilter(list, filter, roster.index);
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const map: Record<string, DirectoryProfile[]> = {};
    for (const m of list) {
      const first = (m.last_name || m.first_name || "#").charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      (map[letter] ??= []).push(m);
    }
    return map;
  }, [members, query, scopedGroupId, filter, roster.index]);
  const letters = Object.keys(sections).sort();

  // Add mode offers everyone the viewer can read who is not already in the
  // group. What RLS shows the leader under the org's directory visibility
  // setting is the whole candidate pool.
  const candidates = useMemo(
    () =>
      Object.values(profileMap)
        .filter((p) => !roster.membershipByProfile.has(p.id))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    [profileMap, roster.membershipByProfile],
  );

  function labelsFor(profileId: string) {
    const applied = roster.index.labelsByProfile.get(profileId);
    return applied ? roster.labels.filter((l) => applied.has(l.id)) : [];
  }

  function membershipIdsFor(profileIds: Iterable<string>): string[] {
    const ids: string[] = [];
    for (const id of profileIds) {
      const membership = roster.membershipByProfile.get(id);
      if (membership) ids.push(membership.id);
    }
    return ids;
  }

  function openPerson(profile: DirectoryProfile) {
    setSelected(profile);
    scrollToPanel();
  }

  function leaveMode() {
    setMode("list");
    setChecked(new Set());
  }

  async function addMember(profile: DirectoryProfile) {
    setBusyId(profile.id);
    const error = await roster.addMember(profile.id);
    setBusyId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Added ${displayName(profile)}.`);
    reload();
  }

  async function saveEdit(changes: EditMemberChanges) {
    if (!editing) return;
    const membership = roster.membershipByProfile.get(editing.id);
    if (!membership) return;
    const errors: string[] = [];
    if (changes.role !== membership.role) {
      const error = await roster.setRole(membership.id, changes.role);
      if (error) errors.push(error);
    }
    for (const labelId of changes.addLabelIds) {
      const error = await roster.applyLabel([membership.id], labelId);
      if (error) errors.push(error);
    }
    for (const labelId of changes.removeLabelIds) {
      const error = await roster.removeLabel([membership.id], labelId);
      if (error) errors.push(error);
    }
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    toast.success("Member updated.");
    setEditing(null);
  }

  async function confirmRemove() {
    if (!removing) return;
    const membership = roster.membershipByProfile.get(removing.id);
    if (!membership) return;
    const error = await roster.removeMember(membership.id);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Removed ${displayName(removing)} from ${groupName}.`);
    if (selected?.id === removing.id) setSelected(null);
    setRemoving(null);
    reload();
  }

  async function bulkApply(labelId: string) {
    const error = await roster.applyLabel(membershipIdsFor(checked), labelId);
    if (error) toast.error(error);
  }

  async function bulkRemove(labelId: string) {
    const error = await roster.removeLabel(membershipIdsFor(checked), labelId);
    if (error) toast.error(error);
  }

  const filtering = scopedGroupId !== null && !isEmptyFilter(filter);
  const emptyMessage =
    memberships.length === 0
      ? "You are not in a group yet."
      : filtering
        ? "No one matches these filters."
        : query
          ? "No members match your search."
          : "No members to show.";

  const toolbar = scopedGroupId && (
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <RosterFilterMenu
        teams={roster.teams}
        labels={roster.labels}
        filter={filter}
        onChange={setFilter}
      />
      {roster.error && (
        <p className="text-base text-muted-foreground">Could not load teams and labels.</p>
      )}
      {isLeader && mode === "list" && (
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setMode("select")}>
            Select
          </Button>
          <Button
            onClick={() => setMode("add")}
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            Add member
          </Button>
        </div>
      )}
    </div>
  );

  const editingMembership = editing ? roster.membershipByProfile.get(editing.id) : undefined;

  if (mode === "add" && scopedGroupId) {
    return (
      <AddMemberPanel
        groupName={groupName}
        candidates={candidates}
        busyId={busyId}
        onAdd={addMember}
        onDone={leaveMode}
      />
    );
  }

  return (
    <>
      <TwoPane
        above={
          <>
            <div className="relative mb-7">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search by name"
                aria-label="Search members"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-13 rounded-xl pl-12 text-base"
              />
            </div>
            {toolbar}
          </>
        }
        list={
          <>
            {letters.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-base text-muted-foreground">{emptyMessage}</p>
                {filtering && (
                  <Button variant="outline" className="mt-4" onClick={() => setFilter(EMPTY_FILTER)}>
                    Clear filters
                  </Button>
                )}
              </div>
            ) : (
              letters.map((letter) => (
                <div key={letter}>
                  <DirSectionLabel>{letter}</DirSectionLabel>
                  <div className="space-y-2.5">
                    {sections[letter].map((m) => {
                      const name = displayName(m);
                      const selecting = mode === "select";
                      return (
                        <DirRow
                          key={m.id}
                          onClick={
                            selecting ? () => setChecked(toggleInSet(checked, m.id)) : () => openPerson(m)
                          }
                          selected={selecting ? checked.has(m.id) : selected?.id === m.id}
                          avatar={
                            <Avatar className="h-12 w-12">
                              {m.avatar_url && <AvatarImage src={m.avatar_url} alt={name} />}
                              <AvatarFallback className="bg-brand-primary text-white">
                                {initials(m)}
                              </AvatarFallback>
                            </Avatar>
                          }
                          title={name}
                          subtitle={m.phone_mobile ? formatPhone(m.phone_mobile) : undefined}
                          trailing={
                            scopedGroupId ? (
                              <LabelPills labels={labelsFor(m.id)} />
                            ) : (
                              <GroupChips profileId={m.id} />
                            )
                          }
                          leading={
                            selecting ? (
                              <Checkbox
                                checked={checked.has(m.id)}
                                onCheckedChange={() => setChecked(toggleInSet(checked, m.id))}
                                aria-label={`Select ${name}`}
                              />
                            ) : undefined
                          }
                          actions={
                            isLeader && mode === "list" ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Edit ${name}`}
                                  onClick={() => setEditing(m)}
                                >
                                  <Pencil aria-hidden="true" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove ${name} from ${groupName}`}
                                  disabled={m.id === currentUserId}
                                  onClick={() => setRemoving(m)}
                                >
                                  <X aria-hidden="true" />
                                </Button>
                              </>
                            ) : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {mode === "select" && (
              <BulkLabelBar
                selectedCount={checked.size}
                labels={roster.labels}
                stateFor={(labelId) => bulkLabelState(checked, labelId, roster.index)}
                onApply={bulkApply}
                onRemove={bulkRemove}
                onDone={leaveMode}
              />
            )}
          </>
        }
        panel={
          selected && mode === "list" ? (
            <>
              <BackLink onClick={() => setSelected(null)} className="mb-4">
                Back to the list
              </BackLink>
              <PersonCard
                profile={selected}
                family={selected.family_id ? (familyMap[selected.family_id] ?? null) : null}
              />
            </>
          ) : null
        }
        placeholder="Choose a person from the list to see their details."
      />

      {editing && editingMembership && (
        <EditMemberDialog
          key={editing.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          personName={displayName(editing)}
          role={editingMembership.role}
          labels={roster.labels}
          appliedLabelIds={roster.index.labelsByProfile.get(editing.id) ?? NO_LABELS}
          groupName={groupName}
          orgName={orgName}
          isSelf={editing.id === currentUserId}
          onSave={saveEdit}
        />
      )}
      {removing && (
        <RemoveMemberDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          personName={displayName(removing)}
          orgName={orgName}
          onConfirm={confirmRemove}
        />
      )}
    </>
  );
}

export function MembersTab() {
  return (
    <DirectoryLoadState>
      <Suspense fallback={null}>
        <MembersTabInner />
      </Suspense>
    </DirectoryLoadState>
  );
}
