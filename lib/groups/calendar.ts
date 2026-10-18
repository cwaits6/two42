import type { SupabaseClient } from "@supabase/supabase-js";

export const GROUP_DEFAULT_COLOR = "#B85C38";

export type GroupCalendar = { id: string; name: string; color: string | null };

// The earliest row by created_at is "the" calendar everywhere the app needs
// exactly one; the schema itself does not forbid a second row per group.
function queryGroupCalendar(supabase: SupabaseClient, orgId: string, groupId: string) {
  return supabase
    .from("event_calendars")
    .select("id, name, color")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .order("created_at")
    .order("id")
    .limit(1)
    .maybeSingle();
}

/**
 * The group's one calendar, or null when the group has none yet. A failed
 * read is thrown rather than reported as null, so an outage cannot read as
 * "no calendar".
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
  const { data, error } = await queryGroupCalendar(supabase, orgId, groupId);
  if (error) {
    console.error("Failed to load the group calendar for group %s:", groupId, error);
    throw new Error(`Failed to load the group calendar: ${error.message}`);
  }
  return data as GroupCalendar | null;
}

/**
 * The group's calendar id, creating the calendar only when the lookup
 * confirmed the group has none. The migration gave every existing group one;
 * this covers a group created afterwards. Returns null when the lookup or
 * the insert fails, so a failed lookup never produces a second calendar.
 */
export async function ensureGroupCalendar(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string,
  groupName: string
): Promise<string | null> {
  const { data: existing, error: lookupError } = await queryGroupCalendar(
    supabase,
    orgId,
    groupId
  );
  if (lookupError) {
    console.error("Failed to load the group calendar for group %s:", groupId, lookupError);
    return null;
  }
  if (existing) return existing.id as string;
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
