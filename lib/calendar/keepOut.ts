import type { SupabaseClient } from "@supabase/supabase-js";
import { eventDetailHref } from "@/components/events/visibleEvents";
import { siteConfig } from "@/lib/config";
import { eventSharing, SHARE_ALL, type CalendarSharing, type SharingColumns } from "@/lib/calendar/sharing";
import type { CalendarKeepOut } from "@/lib/ics-utils";
import type { Event } from "@/lib/types";

/**
 * Each of `groupIds`' calendar sharing defaults, for the groups that saved
 * settings; a group with no row shares everything. A failed read throws:
 * guessing would either leak what a leader kept out or drop details from
 * every member's calendar for the cache's lifetime. `orgId` must come from
 * an already-validated anchor.
 */
export async function calendarSharingByGroup(
  supabase: SupabaseClient,
  orgId: string,
  groupIds: string[]
): Promise<Map<string, CalendarSharing>> {
  if (groupIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("group_settings")
    .select("group_id, calendar_meeting_details, calendar_event_notes, calendar_event_location")
    .eq("org_id", orgId)
    .in("group_id", groupIds);
  if (error) {
    throw new Error(`Failed to load calendar sharing settings: ${error.message}`);
  }
  return new Map(
    (data ?? []).map((row) => [
      row.group_id as string,
      {
        joinDetails: row.calendar_meeting_details,
        notes: row.calendar_event_notes,
        location: row.calendar_event_location,
      },
    ])
  );
}

/**
 * What to keep out of one calendar entry, or undefined when it shares
 * everything. `source` carries the event's own choice: the series row for a
 * moved date, the event itself otherwise.
 */
export function keepOutFor(
  groups: Map<string, CalendarSharing>,
  event: Event,
  source: SharingColumns
): CalendarKeepOut | undefined {
  const share = eventSharing(groups.get(event.group_id) ?? SHARE_ALL, source);
  if (share.joinDetails && share.notes && share.location) return undefined;
  return {
    joinDetails: !share.joinDetails,
    notes: !share.notes,
    location: !share.location,
    eventPageUrl: new URL(eventDetailHref(event), siteConfig.url).toString(),
  };
}
