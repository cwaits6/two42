import { createEvents, type EventAttributes } from "ics";
import type { Event } from "@/lib/types";
import { hasMeeting, notesWithMeeting, type MeetingDetails } from "@/lib/meetings";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { dayKey } from "@/lib/time/zone";

function parseDateToArray(
  isoString: string
): [number, number, number, number, number] {
  const d = new Date(isoString);
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ];
}

function prefixed(prefix: string | undefined, title: string): string {
  return prefix ? `${prefix}: ${title}` : title;
}

/** What a group keeps out of calendar subscriptions; signed-in members still see it all. */
export interface CalendarKeepOut {
  joinDetails: boolean;
  notes: boolean;
  location: boolean;
  eventPageUrl: string;
}

export function eventToICSAttributes(
  event: Event,
  /** `meeting` is the series anchor's for an exception row, which carries none of its own. */
  opts: {
    summaryPrefix?: string;
    meeting?: MeetingDetails | null;
    uid?: string;
    /** What the group keeps out of calendars, and the event page to point to instead. */
    keepOut?: CalendarKeepOut;
  } = {}
): EventAttributes {
  const attrs: EventAttributes = {
    uid: opts.uid ?? event.id,
    title: prefixed(opts.summaryPrefix, event.title),
    start: parseDateToArray(event.start_time),
    startInputType: "utc",
    status: "CONFIRMED",
    ...(event.end_time
      ? { end: parseDateToArray(event.end_time), endInputType: "utc" }
      : { duration: { hours: 1 } }),
  };

  const meeting = opts.meeting ?? event;
  const showJoin = !opts.keepOut?.joinDetails;
  const showNotes = !opts.keepOut?.notes;
  const showLocation = !opts.keepOut?.location;
  // Only what the event has counts as held back; an empty field kept out is nothing to point to.
  const held = [
    !showJoin && hasMeeting(meeting) && "join details",
    !showNotes && event.description && "notes",
    !showLocation && event.location && "location",
  ].filter((part): part is string => Boolean(part));
  const heldList =
    held.length > 1 ? `${held.slice(0, -1).join(", ")} and ${held[held.length - 1]}` : held[0];

  const notes = [
    notesWithMeeting(showNotes ? event.description : null, showJoin ? meeting : null),
    heldList && opts.keepOut
      ? `See the event page for the ${heldList}: ${opts.keepOut.eventPageUrl}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (notes) {
    attrs.description = notes;
  }
  if (showJoin && meeting.meeting_url) {
    attrs.url = meeting.meeting_url;
  } else if (heldList && opts.keepOut) {
    attrs.url = opts.keepOut.eventPageUrl;
  }
  if (showLocation && event.location) {
    attrs.location = event.location;
  }

  return attrs;
}

const EMPTY_CALENDAR =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Small Group Hub//EN\r\nEND:VCALENDAR\r\n";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The dates a subscription lists: a month back, so recent entries don't vanish, to a year ahead. */
export function subscriptionWindow(now: Date = new Date()): { start: Date; end: Date } {
  return { start: new Date(now.getTime() - 30 * DAY_MS), end: new Date(now.getTime() + 365 * DAY_MS) };
}

export interface CalendarEntry {
  event: Event;
  uid: string;
}

/**
 * One entry per date between `windowStart` and `windowEnd`: one-off events,
 * moved dates, and every date of a series. Calendar apps ignore what the app
 * stores about repeating, so each date is written out as its own entry, with
 * a UID per date — one UID per series would collapse them into one.
 * Cancelled exception rows must be passed in: they are what removes a
 * deleted date from its series.
 */
export function calendarEntries(
  events: Event[],
  timeZone: string,
  windowStart: Date,
  windowEnd: Date
): CalendarEntry[] {
  const live = events.filter((e) => e.series_id || !e.is_cancelled);
  return expandUpcomingEvents(live, timeZone, windowStart, windowEnd)
    .filter((e) => new Date(e.start_time) <= windowEnd)
    .map((event) => ({
      event,
      uid:
        !event.series_id && event.recurrence_frequency
          ? `${event.id}-${dayKey(event.start_time, timeZone)}`
          : event.id,
    }));
}

export function generateSingleEventICS(
  entries: CalendarEntry[],
  meeting?: MeetingDetails | null,
  keepOut?: (event: Event) => CalendarKeepOut | undefined
): string {
  if (entries.length === 0) return EMPTY_CALENDAR;
  const { error, value } = createEvents(
    entries.map(({ event, uid }) =>
      eventToICSAttributes(event, { meeting, uid, keepOut: keepOut?.(event) })
    )
  );
  if (error || !value) {
    throw new Error(`Failed to generate ICS: ${error?.message ?? "unknown error"}`);
  }
  return value;
}

export function generateMultiEventICS(events: Event[]): string {
  const { error, value } = createEvents(events.map((event) => eventToICSAttributes(event)));
  if (error || !value) {
    throw new Error(`Failed to generate ICS: ${error?.message ?? "unknown error"}`);
  }
  return value;
}

export interface ServingICSInput {
  signupId: string;
  /** YYYY-MM-DD */
  serviceDate: string;
  teamName: string;
  description?: string;
  /** The group name, on the merged feed only. */
  summaryPrefix?: string;
}

/** All-day calendar entry for a serving Sunday (3-element dates → VALUE=DATE). */
export function servingToICSAttributes(input: ServingICSInput): EventAttributes {
  const [y, m, d] = input.serviceDate.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  return {
    uid: `serving-${input.signupId}`,
    title: prefixed(input.summaryPrefix, `Serving: ${input.teamName}`),
    start: [y, m, d],
    end: [next.getFullYear(), next.getMonth() + 1, next.getDate()],
    status: "CONFIRMED",
    ...(input.description ? { description: input.description } : {}),
  };
}

export function generateServingICS(input: ServingICSInput): string {
  const { error, value } = createEvents([servingToICSAttributes(input)]);
  if (error || !value) {
    throw new Error(`Failed to generate ICS: ${error?.message ?? "unknown error"}`);
  }
  return value;
}

export interface FeedEvent {
  event: Event;
  /** The group name, on the merged feed only. */
  summaryPrefix?: string;
  meeting?: MeetingDetails | null;
  uid?: string;
  keepOut?: CalendarKeepOut;
}

/** Combined feed: the member's groups' events + serving signups in one VCALENDAR. */
export function generateCombinedICS(
  events: FeedEvent[],
  servingSignups: ServingICSInput[]
): string {
  const all: EventAttributes[] = [
    ...events.map(({ event, summaryPrefix, meeting, uid, keepOut }) =>
      eventToICSAttributes(event, { summaryPrefix, meeting, uid, keepOut })
    ),
    ...servingSignups.map(servingToICSAttributes),
  ];
  if (all.length === 0) {
    return EMPTY_CALENDAR;
  }
  const { error, value } = createEvents(all);
  if (error || !value) {
    throw new Error(`Failed to generate ICS: ${error?.message ?? "unknown error"}`);
  }
  return value;
}
