import { groupPath } from "@/lib/groups/active";
import { buildExceptionMap, expandOccurrences } from "@/lib/recurrence";
import type { Event } from "@/lib/types";

/**
 * The occurrences the calendar draws: the visible groups' one-off events,
 * exception rows, and expanded series. The exception map is built from every
 * event before filtering, so an exception row of a hidden group, or a
 * cancelled one, still suppresses its series occurrence.
 */
export function expandVisibleEvents(
  events: Event[],
  visibleGroupIds: ReadonlySet<string>,
  timeZone: string
): Event[] {
  const exceptions = buildExceptionMap(events, timeZone);
  const expanded: Event[] = [];
  for (const e of events) {
    if (!visibleGroupIds.has(e.group_id) || e.is_cancelled) continue;
    if (!e.series_id && e.recurrence_frequency) {
      expanded.push(...expandOccurrences(e, timeZone, exceptions.get(e.id)));
    } else {
      expanded.push(e);
    }
  }
  return expanded;
}

/** The detail page; a series occurrence carries its date so the page knows which one is meant. */
export function eventDetailHref(event: Event): string {
  const occurrence =
    event.recurrence_frequency && !event.series_id
      ? `?occurrence=${encodeURIComponent(event.start_time)}`
      : "";
  return groupPath(event.group_id, `/calendar/${event.id}${occurrence}`);
}
