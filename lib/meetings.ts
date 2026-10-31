import type { Event } from "@/lib/types";

export type JoinState = "upcoming" | "live" | "ended";

/** Assumed duration when an event has no end_time. */
export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

/** How long after an event ends the dashboard keeps showing it (ended state). */
export const ENDED_GRACE_MS = 3 * 60 * 60 * 1000;

export function meetingEndMs(startTime: string, endTime: string | null): number {
  return endTime
    ? new Date(endTime).getTime()
    : new Date(startTime).getTime() + DEFAULT_EVENT_DURATION_MS;
}

export function getJoinState(
  now: Date,
  startTime: string,
  endTime: string | null,
  leadMinutes: number
): JoinState {
  const nowMs = now.getTime();
  const opensMs = new Date(startTime).getTime() - leadMinutes * 60 * 1000;
  if (nowMs < opensMs) return "upcoming";
  if (nowMs < meetingEndMs(startTime, endTime)) return "live";
  return "ended";
}

/** ms until the current join state changes, or null once ended. */
export function msUntilNextJoinTransition(
  now: Date,
  startTime: string,
  endTime: string | null,
  leadMinutes: number
): number | null {
  const nowMs = now.getTime();
  const opensMs = new Date(startTime).getTime() - leadMinutes * 60 * 1000;
  if (nowMs < opensMs) return opensMs - nowMs;
  const endMs = meetingEndMs(startTime, endTime);
  if (nowMs < endMs) return endMs - nowMs;
  return null;
}

/** Provider-aware button label derived from the meeting URL host. */
export function joinButtonLabel(meetingUrl: string): string {
  try {
    const host = new URL(meetingUrl).hostname;
    if (host.includes("zoom.us")) return "Join on Zoom";
    if (host.includes("meet.google.com")) return "Join on Meet";
    if (host.includes("teams.microsoft.com") || host.includes("teams.live.com"))
      return "Join on Teams";
  } catch {
    // fall through to the generic label
  }
  return "Join meeting";
}

/** A meeting needs a link or an ID; a passcode alone has nothing to join. */
export function hasMeeting(m: Pick<Event, "meeting_url" | "meeting_id">): boolean {
  return Boolean(m.meeting_url?.trim() || m.meeting_id?.trim());
}

export type MeetingDetails = Pick<Event, "meeting_url" | "meeting_id" | "meeting_passcode">;

/**
 * An event's notes with its meeting appended, for calendar apps: they show
 * notes but never open two42, so the join details have to travel with them.
 */
export function notesWithMeeting(
  description: string | null,
  meeting: MeetingDetails | null
): string | null {
  const block =
    meeting && hasMeeting(meeting)
      ? [
          "Online meeting",
          meeting.meeting_url && `Join: ${meeting.meeting_url}`,
          meeting.meeting_id && `Meeting ID: ${meeting.meeting_id}`,
          meeting.meeting_passcode && `Passcode: ${meeting.meeting_passcode}`,
        ]
          .filter(Boolean)
          .join("\n")
      : null;
  return [description, block].filter(Boolean).join("\n\n") || null;
}

/**
 * The meeting fields for an occurrence. Exception rows (series_id set) don't
 * carry their own meeting — they inherit from the series anchor, which the
 * caller fetches and passes as `anchor`.
 */
export type MeetingFields = Pick<
  Event,
  | "meeting_url"
  | "meeting_id"
  | "meeting_passcode"
  | "meeting_show_on_dashboard"
  | "meeting_lead_minutes"
>;
