import { createEvents, type EventAttributes } from "ics";
import type { Event } from "@/lib/types";
import { notesWithMeeting, type MeetingDetails } from "@/lib/meetings";

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

export function eventToICSAttributes(
  event: Event,
  /** `meeting` is the series anchor's for an exception row, which carries none of its own. */
  opts: { summaryPrefix?: string; meeting?: MeetingDetails | null } = {}
): EventAttributes {
  const attrs: EventAttributes = {
    uid: event.id,
    title: prefixed(opts.summaryPrefix, event.title),
    start: parseDateToArray(event.start_time),
    startInputType: "utc",
    status: "CONFIRMED",
    ...(event.end_time
      ? { end: parseDateToArray(event.end_time), endInputType: "utc" }
      : { duration: { hours: 1 } }),
  };

  const meeting = opts.meeting ?? event;
  const notes = notesWithMeeting(event.description, meeting);
  if (notes) {
    attrs.description = notes;
  }
  if (meeting.meeting_url) {
    attrs.url = meeting.meeting_url;
  }
  if (event.location) {
    attrs.location = event.location;
  }

  return attrs;
}

export function generateSingleEventICS(event: Event, meeting?: MeetingDetails | null): string {
  const { error, value } = createEvents([eventToICSAttributes(event, { meeting })]);
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
}

/** Combined feed: the member's groups' events + serving signups in one VCALENDAR. */
export function generateCombinedICS(
  events: FeedEvent[],
  servingSignups: ServingICSInput[]
): string {
  const all: EventAttributes[] = [
    ...events.map(({ event, summaryPrefix, meeting }) =>
      eventToICSAttributes(event, { summaryPrefix, meeting })
    ),
    ...servingSignups.map(servingToICSAttributes),
  ];
  if (all.length === 0) {
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Small Group Hub//EN\r\nEND:VCALENDAR\r\n";
  }
  const { error, value } = createEvents(all);
  if (error || !value) {
    throw new Error(`Failed to generate ICS: ${error?.message ?? "unknown error"}`);
  }
  return value;
}
