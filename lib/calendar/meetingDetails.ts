import type { SupabaseClient } from "@supabase/supabase-js";
import { eventDetailHref } from "@/components/events/visibleEvents";
import { siteConfig } from "@/lib/config";
import type { Event } from "@/lib/types";

/**
 * The groups, among `groupIds`, whose leaders keep join details out of
 * calendar subscriptions. A group with no settings row keeps the default (on).
 * A failed read throws: guessing would either leak the details a leader hid
 * or drop them from every member's calendar for the cache's lifetime.
 * `orgId` must come from an already-validated anchor.
 */
export async function groupsHidingMeetingDetails(
  supabase: SupabaseClient,
  orgId: string,
  groupIds: string[]
): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("group_settings")
    .select("group_id")
    .eq("org_id", orgId)
    .in("group_id", groupIds)
    .eq("calendar_meeting_details", false);
  if (error) {
    throw new Error(`Failed to load calendar meeting settings: ${error.message}`);
  }
  return new Set((data ?? []).map((row) => row.group_id as string));
}

/** The event's page on the canonical host, for calendar apps to open. */
export function eventPageUrl(event: Event): string {
  return new URL(eventDetailHref(event), siteConfig.url).toString();
}
