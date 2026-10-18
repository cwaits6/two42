import type { SupabaseClient } from "@supabase/supabase-js";

export const GROUP_DEFAULT_COLOR = "#B85C38";

export type GroupCalendar = { id: string; name: string; color: string | null };

/**
 * The group's one calendar: the earliest row by created_at. Several rows
 * can exist in the schema (a later ticket may allow a second), so the
 * oldest is "the" calendar everywhere the app needs exactly one.
 *
 * Tenancy: the client is a parameter and so untyped as to privilege, so
 * both ids are mandatory predicates and `orgId` must be the caller's
 * already-validated org.
 */
export async function getGroupCalendar(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string
): Promise<GroupCalendar | null> {
  const { data, error } = await supabase
    .from("event_calendars")
    .select("id, name, color")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .order("created_at")
    .order("id")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Failed to load the group calendar for group %s:", groupId, error);
    return null;
  }
  return data as GroupCalendar | null;
}

/**
 * The group's calendar id, creating the calendar when the group has none.
 * The migration gave every existing group one; this covers a group created
 * afterwards. Returns null only when the insert fails.
 */
export async function ensureGroupCalendar(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string,
  groupName: string
): Promise<string | null> {
  const existing = await getGroupCalendar(supabase, orgId, groupId);
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("event_calendars")
    .insert({ org_id: orgId, group_id: groupId, name: groupName, color: GROUP_DEFAULT_COLOR })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Failed to create the calendar for group %s:", groupId, error);
    return null;
  }
  return data.id as string;
}
