import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { HEX } from "@/lib/contrast";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import type { ActiveGroup, GroupRole } from "@/lib/groups/active";

type MembershipRow = {
  group_id: string;
  role: string;
  joined_at: string;
  groups: { name: string } | { name: string }[] | null;
};

type CalendarRow = { group_id: string; color: string | null; created_at: string; id: string };

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
 * CSS, so it passes HEX here. The client is a parameter and so untyped as
 * to privilege; `orgId` must be the caller's already-validated org and the
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
    console.error("Failed to load group memberships:", error);
    throw new Error(`Failed to load group memberships: ${error.message}`);
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
    console.error("Failed to load group calendars:", calendarError);
    throw new Error(`Failed to load group calendars: ${calendarError.message}`);
  }

  const colors = new Map<string, string>();
  for (const calendar of (calendars ?? []) as CalendarRow[]) {
    if (colors.has(calendar.group_id)) continue;
    colors.set(
      calendar.group_id,
      calendar.color && HEX.test(calendar.color) ? calendar.color : GROUP_DEFAULT_COLOR
    );
  }

  return rows.map((row) => ({
    id: row.group_id,
    name: groupName(row),
    color: colors.get(row.group_id) ?? GROUP_DEFAULT_COLOR,
    role: toRole(row.role),
  }));
}
