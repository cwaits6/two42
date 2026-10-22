"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RosterIndex } from "@/components/directory/rosterFilter";
import type { GroupRole } from "@/lib/groups/active";

export interface RosterMembership {
  id: string;
  profileId: string;
  role: GroupRole;
}
export interface RosterTeam {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}
export interface RosterLabel {
  id: string;
  name: string;
  color: string | null;
}

type TeamMemberRow = { team_id: string; profile_id: string };
type MemberLabelRow = { group_member_id: string; label_id: string };

export interface GroupRoster {
  memberships: RosterMembership[];
  membershipByProfile: ReadonlyMap<string, RosterMembership>;
  teams: RosterTeam[];
  labels: RosterLabel[];
  index: RosterIndex;
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
  /** Each mutation resolves to an error message to show, or null on success. */
  addMember: (profileId: string) => Promise<string | null>;
  setRole: (membershipId: string, role: GroupRole) => Promise<string | null>;
  removeMember: (membershipId: string) => Promise<string | null>;
  applyLabel: (membershipIds: string[], labelId: string) => Promise<string | null>;
  removeLabel: (membershipIds: string[], labelId: string) => Promise<string | null>;
}

const UNIQUE_VIOLATION = "23505";

/**
 * One group's roster for the Members tab: memberships, teams, labels and
 * the two applications, plus the leader's writes. Everything runs on the
 * cookie-bound browser client, so RLS is the authority; every chain still
 * names the group, and every filtered write selects the rows it touched,
 * because an UPDATE or DELETE that RLS filters to nothing reports success.
 */
export function useGroupRoster(groupId: string | null): GroupRoster {
  const supabase = useMemo(() => createClient(), []);
  const [memberships, setMemberships] = useState<RosterMembership[]>([]);
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [labels, setLabels] = useState<RosterLabel[]>([]);
  const [memberLabels, setMemberLabels] = useState<MemberLabelRow[]>([]);
  const [loading, setLoading] = useState(groupId !== null);
  const [error, setError] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!groupId) {
      setMemberships([]);
      setTeams([]);
      setTeamMembers([]);
      setLabels([]);
      setMemberLabels([]);
      setLoading(false);
      setError(false);
      return;
    }
    let cancelled = false;

    async function load(id: string) {
      const [members, teamRows, teamMemberRows, labelRows, memberLabelRows] = await Promise.all([
        supabase.from("group_members").select("id, profile_id, role").eq("group_id", id),
        supabase
          .from("teams")
          .select("id, name, color, icon")
          .eq("group_id", id)
          .order("display_order"),
        supabase
          .from("team_members")
          .select("team_id, profile_id, teams!inner(group_id)")
          .eq("teams.group_id", id),
        supabase.from("group_labels").select("id, name, color").eq("group_id", id).order("name"),
        supabase.from("group_member_labels").select("group_member_id, label_id").eq("group_id", id),
      ]);
      if (cancelled) return;

      const failed = (
        [
          ["group_members", members.error],
          ["teams", teamRows.error],
          ["team_members", teamMemberRows.error],
          ["group_labels", labelRows.error],
          ["group_member_labels", memberLabelRows.error],
        ] as const
      ).find(([, err]) => err);
      if (failed) {
        const [source, err] = failed;
        console.error("group roster load error:", { source, message: err?.message, code: err?.code });
        setError(true);
        setLoading(false);
        return;
      }

      setMemberships(
        (members.data ?? []).map((m) => ({
          id: m.id,
          profileId: m.profile_id,
          role: m.role as GroupRole,
        })),
      );
      setTeams(teamRows.data ?? []);
      setTeamMembers(
        (teamMemberRows.data ?? []).map((r) => ({ team_id: r.team_id, profile_id: r.profile_id })),
      );
      setLabels(labelRows.data ?? []);
      setMemberLabels(memberLabelRows.data ?? []);
      setError(false);
      setLoading(false);
    }

    setLoading(true);
    load(groupId);
    return () => {
      cancelled = true;
    };
  }, [supabase, groupId, generation]);

  const reload = useCallback(async () => setGeneration((n) => n + 1), []);

  const membershipByProfile = useMemo(
    () => new Map(memberships.map((m) => [m.profileId, m])),
    [memberships],
  );

  const index = useMemo<RosterIndex>(() => {
    const teamsByProfile = new Map<string, Set<string>>();
    for (const row of teamMembers) {
      let set = teamsByProfile.get(row.profile_id);
      if (!set) teamsByProfile.set(row.profile_id, (set = new Set()));
      set.add(row.team_id);
    }
    const profileByMembership = new Map(memberships.map((m) => [m.id, m.profileId]));
    const labelsByProfile = new Map<string, Set<string>>();
    for (const row of memberLabels) {
      const profileId = profileByMembership.get(row.group_member_id);
      if (!profileId) continue;
      let set = labelsByProfile.get(profileId);
      if (!set) labelsByProfile.set(profileId, (set = new Set()));
      set.add(row.label_id);
    }
    return { teamsByProfile, labelsByProfile };
  }, [teamMembers, memberLabels, memberships]);

  const userId = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  }, [supabase]);

  const addMember = useCallback(
    async (profileId: string) => {
      if (!groupId) return "No group is selected.";
      const { error } = await supabase
        .from("group_members")
        .insert({ group_id: groupId, profile_id: profileId, role: "member", added_by: await userId() });
      if (error) return error.code === UNIQUE_VIOLATION ? "Already in this group." : "Could not add this member.";
      await reload();
      return null;
    },
    [supabase, groupId, userId, reload],
  );

  const setRole = useCallback(
    async (membershipId: string, role: GroupRole) => {
      if (!groupId) return "No group is selected.";
      const { data, error } = await supabase
        .from("group_members")
        .update({ role })
        .eq("id", membershipId)
        .eq("group_id", groupId)
        .select("id");
      if (error || !data?.length) return "Could not change the role.";
      await reload();
      return null;
    },
    [supabase, groupId, reload],
  );

  const removeMember = useCallback(
    async (membershipId: string) => {
      if (!groupId) return "No group is selected.";
      const { data, error } = await supabase
        .from("group_members")
        .delete()
        .eq("id", membershipId)
        .eq("group_id", groupId)
        .select("id");
      if (error || !data?.length) return "Could not remove this member.";
      await reload();
      return null;
    },
    [supabase, groupId, reload],
  );

  const applyLabel = useCallback(
    async (membershipIds: string[], labelId: string) => {
      if (!groupId) return "No group is selected.";
      if (membershipIds.length === 0) return null;
      const appliedBy = await userId();
      const { error } = await supabase.from("group_member_labels").upsert(
        membershipIds.map((id) => ({
          group_id: groupId,
          group_member_id: id,
          label_id: labelId,
          applied_by: appliedBy,
        })),
        { onConflict: "group_member_id,label_id", ignoreDuplicates: true },
      );
      if (error) return "Could not apply the label.";
      await reload();
      return null;
    },
    [supabase, groupId, userId, reload],
  );

  const removeLabel = useCallback(
    async (membershipIds: string[], labelId: string) => {
      if (!groupId) return "No group is selected.";
      if (membershipIds.length === 0) return null;
      const { data, error } = await supabase
        .from("group_member_labels")
        .delete()
        .eq("group_id", groupId)
        .eq("label_id", labelId)
        .in("group_member_id", membershipIds)
        .select("group_member_id");
      if (error || !data?.length) return "Could not remove the label.";
      await reload();
      return null;
    },
    [supabase, groupId, reload],
  );

  return {
    memberships,
    membershipByProfile,
    teams,
    labels,
    index,
    loading,
    error,
    reload,
    addMember,
    setRole,
    removeMember,
    applyLabel,
    removeLabel,
  };
}
