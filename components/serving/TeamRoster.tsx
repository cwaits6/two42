"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DirRow } from "@/components/directory/DirRow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setGroupMembership } from "@/lib/memberGroups";
import { personInitials, personName, spouseFirstName } from "@/lib/serving/display";

export interface TeamRosterPerson {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  family_id: string | null;
  relationship: string | null;
}

const COUPLE = ["primary", "spouse"];

/** The candidate's spouse among the people who could be added, if any. */
export function spouseAmong(person: TeamRosterPerson, candidates: TeamRosterPerson[]): TeamRosterPerson | null {
  if (!person.family_id || !COUPLE.includes(person.relationship ?? "")) return null;
  return (
    candidates.find(
      (c) => c.id !== person.id && c.family_id === person.family_id && COUPLE.includes(c.relationship ?? ""),
    ) ?? null
  );
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
  const [asking, setAsking] = useState<{ person: TeamRosterPerson; spouse: TeamRosterPerson } | null>(null);
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

  async function add(...people: TeamRosterPerson[]) {
    setAsking(null);
    setBusyId(people[0].id);
    const added: string[] = [];
    for (const person of people) {
      const name = personName(person);
      const error = await setGroupMembership({ id: person.id, name }, { id: teamId, name: teamName }, true);
      if (error) {
        toast.error(error);
        break;
      }
      added.push(name);
    }
    setBusyId(null);
    if (added.length > 0) toast.success(`Added ${added.join(" and ")} to ${teamName}.`);
    startRefresh(() => router.refresh());
  }

  /** Someone whose spouse is in the group and not on the team is asked about both. */
  function offer(person: TeamRosterPerson) {
    const spouse = spouseAmong(person, candidates);
    if (spouse) setAsking({ person, spouse });
    else void add(person);
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
                      onClick={() => offer(p)}
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

      <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {asking ? `Also add ${personName(asking.spouse)}?` : ""}
            </DialogTitle>
          </DialogHeader>
          {asking && (
            <div className="flex flex-col gap-3">
              <Button size="lg" onClick={() => add(asking.person, asking.spouse)}>
                Add both
              </Button>
              <Button size="lg" variant="outline" onClick={() => add(asking.person)}>
                Just {spouseFirstName(asking.person)}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
