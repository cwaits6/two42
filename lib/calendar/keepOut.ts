import type { SupabaseClient } from "@supabase/supabase-js";
import { eventDetailHref } from "@/components/events/visibleEvents";
import { siteConfig } from "@/lib/config";
import type { CalendarKeepOut } from "@/lib/ics-utils";
import type { Event } from "@/lib/types";

type KeptOut = Pick<CalendarKeepOut, "joinDetails" | "notes">;

/**
 * What each of `groupIds` keeps out of calendar subscriptions, for the groups
 * that keep anything out; a group with no settings row keeps the defaults
 * (everything in). A failed read throws: guessing would either leak what a
 * leader hid or drop details from every member's calendar for the cache's
 * lifetime. `orgId` must come from an already-validated anchor.
 */
export async function calendarKeepOutByGroup(
  supabase: SupabaseClient,
  orgId: string,
  groupIds: string[]
): Promise<Map<string, KeptOut>> {
  if (groupIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("group_settings")
    .select("group_id, calendar_meeting_details, calendar_event_notes")
    .eq("org_id", orgId)
    .in("group_id", groupIds)
    .or("calendar_meeting_details.eq.false,calendar_event_notes.eq.false");
  if (error) {
    throw new Error(`Failed to load calendar subscription settings: ${error.message}`);
  }
  return new Map(
    (data ?? []).map((row) => [
      row.group_id as string,
      { joinDetails: !row.calendar_meeting_details, notes: !row.calendar_event_notes },
    ])
  );
}

/** The keep-out for one event, pointing at its page on the canonical host. */
export function keepOutFor(
  kept: Map<string, KeptOut>,
  event: Event
): CalendarKeepOut | undefined {
  const k = kept.get(event.group_id);
  return k && { ...k, eventPageUrl: new URL(eventDetailHref(event), siteConfig.url).toString() };
}
