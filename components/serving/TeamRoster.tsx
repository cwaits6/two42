"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DirRow } from "@/components/directory/DirRow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setGroupMembership } from "@/lib/memberGroups";
import { personInitials, personName } from "@/lib/serving/display";

export interface TeamRosterPerson {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
}

export interface TeamRosterMember extends TeamRosterPerson {
  is_leader: boolean;
}

interface TeamRosterProps {
  teamId: string;
  teamName: string;
  groupName: string;
  members: TeamRosterMember[];
  /** Members of the team's group who are not on the team. */
  candidates: TeamRosterPerson[];
}

/**
 * The team's roster for a team lead or group leader: current members by
 * default, an explicit add mode listing the rest of the group, and Remove
 * for anyone who is not a team lead. Writes run on the cookie-bound browser
 * client, so the team_members policies decide.
 */
export function TeamRoster({ teamId, teamName, groupName, members, candidates }: TeamRosterProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"roster" | "add">("roster");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamRosterMember | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const visibleCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((p) =>
      [personName(p), p.first_name, p.last_name, p.email].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [candidates, query]);

  function switchMode(next: "roster" | "add") {
    setMode(next);
    setQuery("");
  }

  async function add(person: TeamRosterPerson) {
    setBusyId(person.id);
    const name = personName(person);
    const error = await setGroupMembership({ id: person.id, name }, { id: teamId, name: teamName }, true);
    setBusyId(null);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Added ${name} to ${teamName}.`);
    startRefresh(() => router.refresh());
  }

  async function remove() {
    if (!removing) return;
    const name = personName(removing);
    const error = await setGroupMembership({ id: removing.id, name }, { id: teamId, name: teamName }, false);
    if (error) {
      toast.error(error);
      return;
    }
    setRemoving(null);
    toast.success(`Removed ${name} from ${teamName}.`);
    startRefresh(() => router.refresh());
  }

  const avatar = (p: TeamRosterPerson) => (
    <Avatar className="h-12 w-12">
      {p.avatar_url && <AvatarImage src={p.avatar_url} alt={personName(p)} />}
      <AvatarFallback className="bg-brand-primary text-white">{personInitials(p)}</AvatarFallback>
    </Avatar>
  );

  return (
    <section aria-labelledby="team-roster-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="team-roster-heading" className="text-2xl font-bold text-brand-primary-text">
          {mode === "add" ? `Add to ${teamName}` : "Team members"}
        </h2>
        {mode === "roster" ? (
          <Button onClick={() => switchMode("add")}>
            <Plus aria-hidden="true" />
            Add person
          </Button>
        ) : (
          <Button variant="outline" onClick={() => switchMode("roster")}>
            Done
          </Button>
        )}
      </div>

      {mode === "roster" ? (
        members.length === 0 ? (
          <p className="py-6 text-base text-muted-foreground">
            No one is on this team yet. Use Add person to build the roster.
          </p>
        ) : (
          <div className="space-y-2.5">
            {members.map((m) => (
              <DirRow
                key={m.id}
                avatar={avatar(m)}
                title={personName(m)}
                subtitle={m.is_leader ? "Team lead" : undefined}
                actions={
                  m.is_leader ? undefined : (
                    <Button
                      variant="outline"
                      disabled={refreshing}
                      onClick={() => setRemoving(m)}
                      aria-label={`Remove ${personName(m)} from ${teamName}`}
                    >
                      Remove
                    </Button>
                  )
                }
              />
            ))}
          </div>
        )
      ) : (
        <>
          <div className="relative mb-5">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search people to add"
              aria-label="Search people to add"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-13 rounded-xl pl-12 text-base"
            />
          </div>
          {visibleCandidates.length === 0 ? (
            <p className="py-6 text-center text-base text-muted-foreground">
              {query.trim()
                ? "No one matches your search."
                : `Everyone in ${groupName} is already on ${teamName}.`}
            </p>
          ) : (
            <div className="space-y-2.5">
              {visibleCandidates.map((p) => (
                <DirRow
                  key={p.id}
                  avatar={avatar(p)}
                  title={personName(p)}
                  actions={
                    <Button
                      variant="outline"
                      disabled={busyId === p.id || refreshing}
                      onClick={() => add(p)}
                      aria-label={`Add ${personName(p)} to ${teamName}`}
                    >
                      <Plus aria-hidden="true" />
                      Add
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove ${personName(removing)} from ${teamName}?` : ""}
        description={`They stay in ${groupName}.`}
        confirmLabel="Remove from team"
        pendingLabel="Removing…"
        onConfirm={remove}
      />
    </section>
  );
}
