import { localToUTCISO } from "@/lib/time/zone";
import type { Announcement } from "@/lib/types";

type Publication = Pick<Announcement, "is_published" | "published_at">;

export type AnnouncementStatus = "Draft" | "Scheduled" | "Published";

/** What the leader picks on the form; each one maps to exactly one status. */
export type PublishChoice = "now" | "schedule" | "draft";

export const PUBLISH_CHOICES: readonly { value: PublishChoice; label: string }[] = [
  { value: "now", label: "Publish now" },
  { value: "schedule", label: "Schedule" },
  { value: "draft", label: "Save as draft" },
];

export function announcementStatus(a: Publication, now: Date = new Date()): AnnouncementStatus {
  if (!a.is_published) return "Draft";
  if (a.published_at && new Date(a.published_at) > now) return "Scheduled";
  return "Published";
}

const CHOICE_FOR: Record<AnnouncementStatus, PublishChoice> = {
  Draft: "draft",
  Scheduled: "schedule",
  Published: "now",
};

export function publishChoiceOf(a: Publication, now: Date = new Date()): PublishChoice {
  return CHOICE_FOR[announcementStatus(a, now)];
}

export type PublishFields =
  | { ok: true; is_published: boolean; published_at: string | null }
  | { ok: false; error: string };

/**
 * The stored columns for a choice. `scheduledLocal` is a datetime-local value
 * read as wall-clock time in `zone`, the church's zone, never the browser's.
 * Publishing something already published keeps its original date.
 */
export function publishFields(
  choice: PublishChoice,
  scheduledLocal: string,
  zone: string,
  now: Date = new Date(),
  previous: Publication | null = null,
): PublishFields {
  if (choice === "draft") return { ok: true, is_published: false, published_at: null };
  if (choice === "now") {
    const keep = previous && announcementStatus(previous, now) === "Published" ? previous.published_at : null;
    return { ok: true, is_published: true, published_at: keep ?? now.toISOString() };
  }
  if (!scheduledLocal) return { ok: false, error: "Enter a date and time to publish." };
  let at: string;
  try {
    at = localToUTCISO(scheduledLocal, zone);
  } catch {
    return { ok: false, error: "Enter a date and time to publish." };
  }
  if (new Date(at) <= now) return { ok: false, error: "Enter a time that hasn't passed yet." };
  return { ok: true, is_published: true, published_at: at };
}
