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
