import { DateTime } from "luxon";
import { formatInZone, zoned } from "@/lib/time/zone";
import { displayName } from "@/lib/names";
import type { PrayerWallRow } from "@/lib/types";

/**
 * The name shown on a wall row. Anonymous rows show no name to anyone (the
 * poster still sees their own "You" badge); a null name on a by-name row
 * means the author is unlisted in the directory.
 */
export function prayerAuthorLabel(
  row: Pick<PrayerWallRow, "is_anonymous" | "first_name" | "last_name" | "preferred_name">
): string {
  if (row.is_anonymous) return "Anonymous";
  const hasName = row.first_name || row.last_name || row.preferred_name;
  return hasName ? displayName(row) : "A member";
}

/** "Just now", "2 hours ago", "Yesterday", then a plain date in `zone`; nothing for a date that won't parse */
export function timeAgo(iso: string, zone: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const sameYear = zoned(iso, zone).year === DateTime.fromJSDate(now, { zone }).year;
  return formatInZone(iso, zone, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/**
 * A prayer_wall row as the page renders it. The view's computed columns are
 * nullable, and one stray value must not take the page down with it, so
 * every field falls back to something the card can show.
 */
export function toWallRow(raw: Record<string, unknown>): PrayerWallRow {
  return {
    id: text(raw.id),
    group_id: text(raw.group_id),
    body: text(raw.body),
    is_anonymous: raw.is_anonymous === true,
    is_answered: raw.is_answered === true,
    created_at: text(raw.created_at),
    mine: raw.mine === true,
    first_name: textOrNull(raw.first_name),
    last_name: textOrNull(raw.last_name),
    preferred_name: textOrNull(raw.preferred_name),
    avatar_url: textOrNull(raw.avatar_url),
    praying_count: count(raw.praying_count),
    i_am_praying: raw.i_am_praying === true,
  };
}
