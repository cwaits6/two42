import type { Event, GroupSettings } from "@/lib/types";

/** What calendar subscriptions carry for an event. */
export interface CalendarSharing {
  joinDetails: boolean;
  notes: boolean;
  location: boolean;
}

export const SHARE_ALL: CalendarSharing = { joinDetails: true, notes: true, location: true };

export type SharingColumns = Pick<
  Event,
  "calendar_meeting_details" | "calendar_event_notes" | "calendar_event_location"
>;

type GroupSharingColumns = Pick<
  GroupSettings,
  "calendar_meeting_details" | "calendar_event_notes" | "calendar_event_location"
>;

export function groupSharing(settings: GroupSharingColumns): CalendarSharing {
  return {
    joinDetails: settings.calendar_meeting_details,
    notes: settings.calendar_event_notes,
    location: settings.calendar_event_location,
  };
}

/** True when the event or series made its own choice instead of following the group. */
export function hasOwnSharing(event: SharingColumns): boolean {
  return (
    event.calendar_meeting_details !== null ||
    event.calendar_event_notes !== null ||
    event.calendar_event_location !== null
  );
}

/** The event's own choice where it made one, the group's everywhere else. */
export function eventSharing(group: CalendarSharing, event: SharingColumns): CalendarSharing {
  return {
    joinDetails: event.calendar_meeting_details ?? group.joinDetails,
    notes: event.calendar_event_notes ?? group.notes,
    location: event.calendar_event_location ?? group.location,
  };
}

/** The columns to save: an event's own choice, or nulls to follow the group. */
export function sharingColumns(own: CalendarSharing | null): SharingColumns {
  return {
    calendar_meeting_details: own ? own.joinDetails : null,
    calendar_event_notes: own ? own.notes : null,
    calendar_event_location: own ? own.location : null,
  };
}

const PARTS: { key: keyof CalendarSharing; name: string }[] = [
  { key: "joinDetails", name: "join details" },
  { key: "notes", name: "notes" },
  { key: "location", name: "location" },
];

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

/** "Shares notes and location. Keeps join details on the event page." */
export function sharingSummary(s: CalendarSharing): string {
  const shared = PARTS.filter((p) => s[p.key]).map((p) => p.name);
  const kept = PARTS.filter((p) => !s[p.key]).map((p) => p.name);
  if (kept.length === 0) return "Shares join details, notes and location.";
  if (shared.length === 0) return "Keeps join details, notes and location on the event page.";
  return `Shares ${list(shared)}. Keeps ${list(kept)} on the event page.`;
}
