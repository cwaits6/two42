import type { createClient } from "@/lib/supabase/client";
import { occurrenceEndTime } from "@/lib/recurrence";
import type { Event } from "@/lib/types";

type BrowserClient = ReturnType<typeof createClient>;

/**
 * Remove one date of a repeating event by writing a cancelled exception row
 * for it. The series row is untouched: readers skip the date because the row
 * is in the exception map, and never render the row itself.
 */
export async function cancelOccurrence(
  supabase: BrowserClient,
  series: Event,
  occurrenceISO: string
): Promise<boolean> {
  const occurrenceStart = new Date(occurrenceISO).toISOString();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: inserted, error } = await supabase
    .from("events")
    .insert({
      title: series.title,
      start_time: occurrenceStart,
      end_time: occurrenceEndTime(series, occurrenceStart),
      group_id: series.group_id,
      calendar_id: series.calendar_id,
      created_by: user?.id,
      series_id: series.id,
      series_occurrence_date: occurrenceStart,
      is_cancelled: true,
    })
    .select("id");

  return !error && (inserted?.length ?? 0) > 0;
}

/**
 * Delete an event row: a one-off, or a series together with every date that
 * hangs off it. A zero-row match is a stale or cross-group id, not a success.
 */
export async function deleteEvent(
  supabase: BrowserClient,
  eventId: string,
  groupId: string
): Promise<boolean> {
  const { data: deleted, error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .eq("group_id", groupId)
    .select("id");

  return !error && (deleted?.length ?? 0) > 0;
}
