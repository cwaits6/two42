import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_DEFAULT_COLOR, groupColor } from "@/lib/groups/calendar";
import type { ActiveGroup, GroupRole } from "@/lib/groups/active";
import { isGroupAbility, type GroupAbility } from "@/lib/groups/abilities";
import { logError } from "@/lib/log";

type MembershipRow = {
  group_id: string;
  role: string;
  joined_at: string;
  groups: { name: string } | { name: string }[] | null;
};

type CalendarRow = { group_id: string; color: string | null; created_at: string; id: string };

type AbilityRow = { group_id: string; ability: string };

type TeamRow = {
  teams: { group_id: string; team_abilities: { ability: string }[] | null } | null;
};

function toRole(value: string): GroupRole {
  return value === "leader" ? "leader" : "member";
}

function groupName(row: MembershipRow): string {
  const embedded = Array.isArray(row.groups) ? row.groups[0] : row.groups;
  return embedded?.name ?? "Group";
}

/**
 * The viewer's groups, ordered by joined_at so "first membership" is
 * deterministic. A group's color is its calendar's color (the first
 * calendar by created_at), Clay when the group has none. The value reaches
 * CSS, so it goes through groupColor(). The client is a parameter and so
 * untyped as to privilege; `orgId` must be the caller's already-validated org and the
 * predicate is mandatory. A query error is thrown rather than reported as
 * an empty list, so a database failure cannot read as "not a member".
 */
export async function loadGroupMemberships(
  client: SupabaseClient<Database>,
  opts: { profileId: string; orgId: string }
): Promise<ActiveGroup[]> {
  const { data, error } = await client
    .from("group_members")
    .select("group_id, role, joined_at, groups(name)")
    .eq("profile_id", opts.profileId)
    .eq("org_id", opts.orgId)
    .order("joined_at")
    .order("group_id");

  if (error) {
    logError("Failed to load group memberships", error);
    throw new Error("Failed to load group memberships");
  }

  const rows = (data ?? []) as MembershipRow[];
  if (rows.length === 0) return [];

  const { data: calendars, error: calendarError } = await client
    .from("event_calendars")
    .select("group_id, color, created_at, id")
    .eq("org_id", opts.orgId)
    .in(
      "group_id",
      rows.map((row) => row.group_id)
    )
    .order("created_at")
    .order("id");

  if (calendarError) {
    logError("Failed to load group calendars", calendarError);
    throw new Error("Failed to load group calendars");
  }

  const colors = new Map<string, string>();
  for (const calendar of (calendars ?? []) as CalendarRow[]) {
    if (colors.has(calendar.group_id)) continue;
    colors.set(calendar.group_id, groupColor(calendar.color));
  }

  const abilities = await loadAbilities(client, opts);

  return rows.map((row) => {
    const held = abilities.get(row.group_id);
    return {
      id: row.group_id,
      name: groupName(row),
      color: colors.get(row.group_id) ?? GROUP_DEFAULT_COLOR,
      role: toRole(row.role),
      ...(held ? { abilities: [...held] } : {}),
    };
  });
}

/**
 * The abilities a leader gave the viewer in each group, directly or through a
 * team linked to one. Same contract as loadGroupMemberships(): `orgId` is the
 * caller's validated org, and a failed read throws rather than reading as "none".
 */
async function loadAbilities(
  client: SupabaseClient<Database>,
  opts: { profileId: string; orgId: string }
): Promise<Map<string, Set<GroupAbility>>> {
  const [direct, viaTeams] = await Promise.all([
    client
      .from("group_member_abilities")
      .select("group_id, ability")
      .eq("profile_id", opts.profileId)
      .eq("org_id", opts.orgId),
    client
      .from("team_members")
      .select("teams(group_id, team_abilities(ability))")
      .eq("profile_id", opts.profileId)
      .eq("org_id", opts.orgId),
  ]);
  if (direct.error || viaTeams.error) {
    logError("Failed to load group abilities", direct.error ?? viaTeams.error);
    throw new Error("Failed to load group abilities");
  }

  const byGroup = new Map<string, Set<GroupAbility>>();
  const add = (groupId: string, ability: string) => {
    if (!isGroupAbility(ability)) return;
    const held = byGroup.get(groupId) ?? new Set<GroupAbility>();
    held.add(ability);
    byGroup.set(groupId, held);
  };
  for (const row of (direct.data ?? []) as AbilityRow[]) add(row.group_id, row.ability);
  for (const row of (viaTeams.data ?? []) as unknown as TeamRow[]) {
    if (!row.teams) continue;
    for (const link of row.teams.team_abilities ?? []) add(row.teams.group_id, link.ability);
  }
  return byGroup;
}
