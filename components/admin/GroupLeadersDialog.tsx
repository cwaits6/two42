"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { displayName } from "@/lib/names";
import {
  addLeader,
  leaderCandidates,
  leadersOf,
  loadLeaderRoster,
  removeLeader,
  type Candidate,
  type LeaderPerson,
  type LeaderRoster,
} from "@/components/admin/groupLeaders";

export interface LeaderGroup {
  id: string;
  name: string;
}

export type LeadersMode =
  | { kind: "leaders" }
  | { kind: "add"; replacing: LeaderPerson | null };

interface GroupLeadersViewProps {
  groupName: string;
  /** Null while loading or after a failed load. */
  roster: LeaderRoster | null;
  loadFailed: boolean;
  mode: LeadersMode;
  query: string;
  busy: boolean;
  error: string | null;
  onModeChange: (mode: LeadersMode) => void;
  onQueryChange: (query: string) => void;
  onAdd: (candidate: Candidate) => void;
  onRemove: (person: LeaderPerson) => void;
}

/** The dialog's body: current leaders by default, an explicit add mode to name one. */
export function GroupLeadersView({
  groupName,
  roster,
  loadFailed,
  mode,
  query,
  busy,
  error,
  onModeChange,
  onQueryChange,
  onAdd,
  onRemove,
}: GroupLeadersViewProps) {
  const adding = mode.kind === "add";
  const title = !adding
    ? `Leaders of ${groupName}`
    : mode.replacing
      ? `Replace ${displayName(mode.replacing)}`
      : `Add leader to ${groupName}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 pr-8">
          {adding && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onModeChange({ kind: "leaders" })}
              aria-label="Back to leaders"
              className="-ml-2 shrink-0"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
          )}
          {title}
        </DialogTitle>
        <DialogDescription>
          {adding
            ? "Choose someone from this group or the church directory."
            : "Leaders run the group. A group can have several, each with the same rights."}
        </DialogDescription>
      </DialogHeader>

      {error && (
        <p role="alert" className="text-base font-medium text-destructive">
          {error}
        </p>
      )}

      {loadFailed ? (
        <p role="alert" className="py-4 text-base text-muted-foreground">
          Couldn&apos;t load this group&apos;s leaders. Close this and open it again.
        </p>
      ) : !roster ? (
        <p className="py-4 text-base text-muted-foreground">Loading leaders...</p>
      ) : adding ? (
        <AddLeaderList
          roster={roster}
          query={query}
          busy={busy}
          onQueryChange={onQueryChange}
          onAdd={onAdd}
        />
      ) : (
        <LeaderList
          leaders={leadersOf(roster)}
          busy={busy}
          onModeChange={onModeChange}
          onRemove={onRemove}
        />
      )}
    </>
  );
}

function LeaderList({
  leaders,
  busy,
  onModeChange,
  onRemove,
}: {
  leaders: LeaderPerson[];
  busy: boolean;
  onModeChange: (mode: LeadersMode) => void;
  onRemove: (person: LeaderPerson) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {leaders.length === 0 ? (
        <p className="py-2 text-base text-muted-foreground">This group has no leader yet.</p>
      ) : (
        <ul className="-mx-1 flex-1 divide-y overflow-y-auto px-1">
          {leaders.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 text-lg font-medium break-words">{displayName(p)}</span>
              <div className="flex gap-2 *:flex-1 sm:*:flex-none">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onModeChange({ kind: "add", replacing: p })}
                  aria-label={`Replace ${displayName(p)}`}
                >
                  Replace
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => onRemove(p)}
                  aria-label={`Remove ${displayName(p)} as leader`}
                  className="text-destructive"
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        disabled={busy}
        onClick={() => onModeChange({ kind: "add", replacing: null })}
        className="w-full sm:w-auto sm:self-start"
      >
        <Plus aria-hidden="true" />
        Add leader
      </Button>
    </div>
  );
}

function AddLeaderList({
  roster,
  query,
  busy,
  onQueryChange,
  onAdd,
}: {
  roster: LeaderRoster;
  query: string;
  busy: boolean;
  onQueryChange: (query: string) => void;
  onAdd: (candidate: Candidate) => void;
}) {
  const candidates = leaderCandidates(roster, query);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0">
        <Search
          aria-hidden="true"
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search people"
          placeholder="Search people..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-12 pl-10 text-base"
        />
      </div>
      {candidates.length === 0 ? (
        <p className="py-4 text-base text-muted-foreground">
          {query.trim() ? "No one matches your search." : "Everyone in the directory already leads this group."}
        </p>
      ) : (
        <ul className="-mx-1 flex-1 divide-y overflow-y-auto px-1">
          {candidates.map(({ person, inGroup }) => (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-medium">{displayName(person)}</p>
                <p className="text-base text-muted-foreground">
                  {inGroup ? "In this group" : "Not in this group yet"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => onAdd({ person, inGroup })}
                aria-label={`Make ${displayName(person)} a leader`}
              >
                <Plus aria-hidden="true" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A church admin names, replaces and removes a group's leaders without
 * joining it. Writes go through the cookie-bound browser client, where the
 * admin arm of the group_members policies permits them.
 */
export function GroupLeadersDialog({
  group,
  onClose,
  onChanged,
}: {
  group: LeaderGroup | null;
  onClose: () => void;
  /** Called after any change, so server-rendered leader names can refresh. */
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [roster, setRoster] = useState<LeaderRoster | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [mode, setMode] = useState<LeadersMode>({ kind: "leaders" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupId = group?.id;

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    setRoster(null);
    setLoadFailed(false);
    setMode({ kind: "leaders" });
    setQuery("");
    setError(null);
    loadLeaderRoster(supabase, groupId).then((loaded) => {
      if (cancelled) return;
      setRoster(loaded);
      setLoadFailed(loaded === null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, groupId]);

  /**
   * Re-read the roster after a committed write. A failed read drops the
   * stale list rather than keep showing it: acting on it would hit rows the
   * write already changed. Resolves false when the read failed.
   */
  async function refresh(id: string): Promise<boolean> {
    const loaded = await loadLeaderRoster(supabase, id);
    setRoster(loaded);
    setLoadFailed(loaded === null);
    onChanged();
    return loaded !== null;
  }

  function changeMode(next: LeadersMode) {
    setMode(next);
    setQuery("");
    setError(null);
  }

  async function handleAdd({ person, inGroup }: Candidate) {
    if (!group || mode.kind !== "add") return;
    const replacing = mode.replacing;
    setBusy(true);
    setError(null);
    try {
      const addError = await addLeader(supabase, group.id, person.id, inGroup);
      if (addError) {
        setError(addError);
        return;
      }
      if (replacing) {
        const removeError = await removeLeader(supabase, group.id, replacing.id);
        if (removeError) {
          const reloaded = await refresh(group.id);
          setMode({ kind: "leaders" });
          setQuery("");
          setError(
            `${displayName(person)} is a leader now, but ${displayName(replacing)} is still one. ` +
              (reloaded ? "Remove them below." : "Close this and open it again to remove them."),
          );
          return;
        }
      }
      await refresh(group.id);
      changeMode({ kind: "leaders" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(person: LeaderPerson) {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const removeError = await removeLeader(supabase, group.id, person.id);
      if (removeError) {
        setError(removeError);
        return;
      }
      await refresh(group.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        {group && (
          <GroupLeadersView
            groupName={group.name}
            roster={roster}
            loadFailed={loadFailed}
            mode={mode}
            query={query}
            busy={busy}
            error={error}
            onModeChange={changeMode}
            onQueryChange={setQuery}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
