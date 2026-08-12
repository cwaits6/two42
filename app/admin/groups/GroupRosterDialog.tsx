"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

interface GroupRosterDialogProps {
  group: MemberGroup | null;
  onClose: () => void;
  /** Called with the new member count whenever the roster changes */
  onCountChange: (groupId: string, count: number) => void;
}

/**
 * Group roster management, Okta-style: the default view shows only who is
 * currently in the group (with remove), and an explicit "Add members" mode
 * searches the rest of the class. Denormalized role flags on profiles stay
 * in sync via database triggers.
 */
export function GroupRosterDialog({
  group,
  onClose,
  onCountChange,
}: GroupRosterDialogProps) {
  const [profiles, setProfiles] = useState<RosterProfile[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [leaders, setLeaders] = useState<Set<string>>(new Set());
  // Which group the current profiles/assigned belong to — anything else is
  // stale data from a previously opened group and must render as loading.
  const [loadedGroupId, setLoadedGroupId] = useState<string | null>(null);
  const [mode, setMode] = useState<"roster" | "add">("roster");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const groupId = group?.id;

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;

    async function load(groupId: string) {
      setMode("roster");
      setQuery("");
      const [{ data: members, error: mErr }, { data: rows, error: rErr }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, first_name, last_name, preferred_name, avatar_url")
            .in("role", ["member", "content_editor", "admin"])
            .order("last_name", { ascending: true })
            .order("first_name", { ascending: true }),
          supabase
            .from("profile_groups")
            .select("profile_id, is_leader")
            .eq("group_id", groupId),
        ]);

      if (cancelled) return;
      if (mErr || rErr) {
        toast.error("Failed to load roster.");
        return;
      }
      const memberRows = (rows || []) as { profile_id: string; is_leader: boolean }[];
      // Private buckets (CWA-59): exchange stored avatar URLs for signed
      // URLs before they reach the AvatarImage renders below.
      const profileRows = (members || []) as RosterProfile[];
      const signed = await mintSignedUrls(profileRows.map((p) => p.avatar_url));
      if (cancelled) return;
      setProfiles(profileRows.map((p, i) => ({ ...p, avatar_url: signed[i] })));
      setAssigned(new Set(memberRows.map((r) => r.profile_id)));
      setLeaders(
        new Set(memberRows.filter((r) => r.is_leader).map((r) => r.profile_id)),
      );
      setLoadedGroupId(groupId);
    }

    load(groupId);
    return () => {
      cancelled = true;
    };
  }, [groupId, supabase]);

  const loading = !group || loadedGroupId !== group.id;

  const roster = useMemo(
    () => profiles.filter((p) => assigned.has(p.id)),
    [profiles, assigned],
  );
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
    if (!group) return;
    setBusy(profile.id);

    const errorMessage = await setGroupMembership(profile.id, group, member);
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
    onCountChange(group.id, next.size);
    setBusy(null);
  }

  async function handleLeaderChange(profile: RosterProfile, leader: boolean) {
    if (!group) return;
    setBusy(profile.id);

    const { error } = await supabase
      .from("profile_groups")
      .update({ is_leader: leader })
      .eq("profile_id", profile.id)
      .eq("group_id", group.id);

    if (error) {
      toast.error("Failed to update leader.");
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
    <Dialog open={!!group} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "add" && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => switchMode("roster")}
                aria-label="Back to members"
                className="-ml-2 shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {group?.color && (
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: group.color }}
              />
            )}
            {mode === "add"
              ? `Add to ${group?.name}`
              : loading
                ? group?.name
                : `${group?.name} — ${assigned.size} member${assigned.size !== 1 ? "s" : ""}`}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
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
              size="sm"
              onClick={() => switchMode("add")}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white shrink-0"
            >
              <Plus className="mr-1 h-4 w-4" />
              Add members
            </Button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 -mx-1 px-1">
          {loading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Loading members...
            </p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {query.trim()
                ? "No one matches your search."
                : mode === "roster"
                  ? "No members in this group yet. Use “Add members” to build the roster."
                  : "Everyone is already in this group."}
            </p>
          ) : (
            <div className="divide-y">
              {visible.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2.5">
                  <Avatar className="h-8 w-8 shrink-0">
                    {p.avatar_url && (
                      <AvatarImage src={p.avatar_url} alt={displayName(p)} />
                    )}
                    <AvatarFallback className="bg-brand-primary text-white text-xs">
                      {initials(p)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0 text-sm font-medium truncate">
                    {displayName(p)}
                    {leaders.has(p.id) && (
                      <span className="ml-2 text-xs font-medium uppercase tracking-wider text-brand-accent">
                        Leader
                      </span>
                    )}
                  </span>
                  {mode === "roster" ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy === p.id}
                        onClick={() => handleLeaderChange(p, !leaders.has(p.id))}
                        aria-label={
                          leaders.has(p.id)
                            ? `Remove ${displayName(p)} as leader of ${group?.name}`
                            : `Make ${displayName(p)} a leader of ${group?.name}`
                        }
                        className={
                          leaders.has(p.id)
                            ? "text-brand-accent hover:text-muted-foreground"
                            : "text-muted-foreground hover:text-brand-accent"
                        }
                      >
                        <Star
                          className="h-4 w-4"
                          fill={leaders.has(p.id) ? "currentColor" : "none"}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy === p.id}
                        onClick={() => handleChange(p, false)}
                        aria-label={`Remove ${displayName(p)} from ${group?.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === p.id}
                      onClick={() => handleChange(p, true)}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
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
