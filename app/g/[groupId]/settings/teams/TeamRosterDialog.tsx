"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { mintSignedUrls } from "@/lib/uploadImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ArrowLeft, Plus, Search, Star, X } from "lucide-react";
import { setGroupMembership } from "@/lib/memberGroups";
import { displayName, initials } from "@/lib/names";
import type { MemberGroup, Profile } from "@/lib/types";

type RosterProfile = Pick<
  Profile,
  "id" | "first_name" | "last_name" | "preferred_name" | "avatar_url"
>;

interface TeamRosterDialogProps {
  team: MemberGroup | null;
  groupId: string;
  groupName: string;
  onClose: () => void;
  /** Called with the new member count whenever the roster changes */
  onCountChange: (teamId: string, count: number) => void;
}

/**
 * Team roster management: the default view shows only who is currently on
 * the team (with remove), and an explicit "Add to team" mode searches the
 * rest of the group. A team lives inside one group, so only the group's
 * members are candidates.
 */
export function TeamRosterDialog({
  team,
  groupId,
  groupName,
  onClose,
  onCountChange,
}: TeamRosterDialogProps) {
  const [profiles, setProfiles] = useState<RosterProfile[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [leaders, setLeaders] = useState<Set<string>>(new Set());
  // Which team the current profiles/assigned belong to — anything else is
  // stale data from a previously opened team and must render as loading.
  const [loadedTeamId, setLoadedTeamId] = useState<string | null>(null);
  const [mode, setMode] = useState<"roster" | "add">("roster");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const teamId = team?.id;

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;

    async function load(teamId: string) {
      setMode("roster");
      setQuery("");
      try {
        const [{ data: members, error: mErr }, { data: rows, error: rErr }] =
          await Promise.all([
            fetchAll((from, to) =>
              supabase
                .from("group_members")
                .select("profile_id, profiles(id, first_name, last_name, preferred_name, avatar_url)")
                .eq("group_id", groupId)
                .order("id")
                .range(from, to)
                .returns<{ profile_id: string; profiles: RosterProfile | null }[]>(),
            ),
            fetchAll((from, to) =>
              supabase
                .from("team_members")
                .select("profile_id, is_leader")
                .eq("team_id", teamId)
                .order("team_id")
                .order("profile_id")
                .range(from, to),
            ),
          ]);

        if (cancelled) return;
        if (mErr || rErr) {
          toast.error("Failed to load roster.");
          return;
        }
        const memberRows = (rows || []) as { profile_id: string; is_leader: boolean }[];
        // A null embed is a profile RLS hides from the viewer; skip it.
        const profileRows = (members || [])
          .map((m) => m.profiles)
          .filter((p): p is RosterProfile => p !== null)
          .sort((a, b) =>
            `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(
              `${b.last_name ?? ""} ${b.first_name ?? ""}`,
            ),
          );
        // Private buckets: exchange stored avatar URLs for signed
        // URLs before they reach the AvatarImage renders below.
        const signed = await mintSignedUrls(profileRows.map((p) => p.avatar_url));
        if (cancelled) return;
        setProfiles(profileRows.map((p, i) => ({ ...p, avatar_url: signed[i] })));
        setAssigned(new Set(memberRows.map((r) => r.profile_id)));
        setLeaders(
          new Set(memberRows.filter((r) => r.is_leader).map((r) => r.profile_id)),
        );
        setLoadedTeamId(teamId);
      } catch (err) {
        if (cancelled) return;
        console.error("TeamRosterDialog load failed", err);
        toast.error("Failed to load roster.");
      }
    }

    load(teamId);
    return () => {
      cancelled = true;
    };
  }, [teamId, groupId, supabase]);

  const loading = !team || loadedTeamId !== team.id;

  const roster = useMemo(
    () => profiles.filter((p) => assigned.has(p.id)),
    [profiles, assigned],
  );
  // Team rows whose profile RLS hides from the viewer: counted on the team,
  // but there is no one to list.
  const hiddenCount = useMemo(() => {
    const listed = new Set(profiles.map((p) => p.id));
    let n = 0;
    for (const id of assigned) if (!listed.has(id)) n += 1;
    return n;
  }, [profiles, assigned]);
  const candidates = useMemo(
    () => profiles.filter((p) => !assigned.has(p.id)),
    [profiles, assigned],
  );

  const visible = useMemo(() => {
    const source = mode === "roster" ? roster : candidates;
    if (!query.trim()) return source;
    const q = query.trim().toLowerCase();
    return source.filter((p) =>
      [p.first_name, p.last_name, p.preferred_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [mode, roster, candidates, query]);

  async function handleChange(profile: RosterProfile, member: boolean) {
    if (!team) return;
    setBusy(profile.id);

    const errorMessage = await setGroupMembership({ id: profile.id, name: displayName(profile) }, team, member);
    if (errorMessage) {
      toast.error(errorMessage);
      setBusy(null);
      return;
    }

    const next = new Set(assigned);
    if (member) next.add(profile.id);
    else next.delete(profile.id);
    setAssigned(next);
    if (!member && leaders.has(profile.id)) {
      const nextLeaders = new Set(leaders);
      nextLeaders.delete(profile.id);
      setLeaders(nextLeaders);
    }
    onCountChange(team.id, next.size);
    setBusy(null);
  }

  async function handleLeaderChange(profile: RosterProfile, leader: boolean) {
    if (!team) return;
    setBusy(profile.id);

    const { data, error } = await supabase
      .from("team_members")
      .update({ is_leader: leader })
      .eq("profile_id", profile.id)
      .eq("team_id", team.id)
      .select("profile_id");

    if (error || !data?.length) {
      toast.error("Failed to update team lead.");
      setBusy(null);
      return;
    }

    const next = new Set(leaders);
    if (leader) next.add(profile.id);
    else next.delete(profile.id);
    setLeaders(next);
    setBusy(null);
  }

  function switchMode(next: "roster" | "add") {
    setMode(next);
    setQuery("");
  }

  return (
    <Dialog open={!!team} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "add" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => switchMode("roster")}
                aria-label="Back to members"
                className="-ml-2 shrink-0"
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
            )}
            {team?.color && (
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: team.color }}
              />
            )}
            {mode === "add"
              ? `Add to ${team?.name}`
              : loading
                ? team?.name
                : `${team?.name} — ${assigned.size} member${assigned.size !== 1 ? "s" : ""}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={
                mode === "roster" ? "Search members..." : "Search people to add..."
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          {mode === "roster" && (
            <Button
              onClick={() => switchMode("add")}
              className="shrink-0"
            >
              <Plus aria-hidden="true" />
              Add to team
            </Button>
          )}
        </div>

        {!loading && mode === "roster" && hiddenCount > 0 && (
          <p className="text-base text-muted-foreground shrink-0">
            {hiddenCount} on this team {hiddenCount === 1 ? "is" : "are"} not visible to you.
          </p>
        )}

        <div className="overflow-y-auto flex-1 -mx-1 px-1">
          {loading ? (
            <p className="text-base text-muted-foreground py-4 text-center">
              Loading members...
            </p>
          ) : visible.length === 0 ? (
            <p className="text-base text-muted-foreground py-6 text-center">
              {query.trim()
                ? "No one matches your search."
                : mode === "roster"
                  ? "No one on this team yet. Use “Add to team” to build the roster."
                  : `Everyone in ${groupName} is already on this team.`}
            </p>
          ) : (
            <div className="divide-y">
              {visible.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2">
                  <Avatar className="h-10 w-10 shrink-0">
                    {p.avatar_url && (
                      <AvatarImage src={p.avatar_url} alt={displayName(p)} />
                    )}
                    <AvatarFallback className="bg-brand-primary text-white">
                      {initials(p)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0 truncate text-base font-medium">
                    {displayName(p)}
                    {leaders.has(p.id) && (
                      <span className="ml-2 font-medium text-brand-accent-text">
                        Team lead
                      </span>
                    )}
                  </span>
                  {mode === "roster" ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy === p.id}
                        onClick={() => handleLeaderChange(p, !leaders.has(p.id))}
                        aria-label={
                          leaders.has(p.id)
                            ? `Remove ${displayName(p)} as team lead of ${team?.name}`
                            : `Make ${displayName(p)} team lead of ${team?.name}`
                        }
                        className={
                          leaders.has(p.id)
                            ? "text-brand-accent hover:text-muted-foreground"
                            : "text-muted-foreground hover:text-brand-accent"
                        }
                      >
                        <Star
                          aria-hidden="true"
                          fill={leaders.has(p.id) ? "currentColor" : "none"}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy === p.id}
                        onClick={() => handleChange(p, false)}
                        aria-label={`Remove ${displayName(p)} from ${team?.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={busy === p.id}
                      onClick={() => handleChange(p, true)}
                      aria-label={`Add ${displayName(p)} to ${team?.name}`}
                    >
                      <Plus aria-hidden="true" />
                      Add
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
