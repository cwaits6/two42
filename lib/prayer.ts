import { DateTime } from "luxon";
import { formatInZone, zoned } from "@/lib/time/zone";
import { displayName } from "@/lib/names";
import type { PrayerCallSession, PrayerWallRow } from "@/lib/types";

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

/** Plural weekday names, indexed by PrayerCallSession.weekday (0 = Sunday) */
export const WEEKDAY_LABELS = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)/;

/** "20:00:00" → "8:00 PM" (drop the meridiem when told to share it); anything else as stored */
function formatTime(time: string, withMeridiem = true): string {
  const match = TIME.exec(time);
  if (!match) return time;
  const h = Number(match[1]);
  const meridiem = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const base = `${hour12}:${match[2]}`;
  return withMeridiem ? `${base} ${meridiem}` : base;
}

const isMorning = (time: string) => Number(TIME.exec(time)?.[1] ?? 0) < 12;

/** "Wednesdays · 8:00 – 8:30 PM" */
export function sessionLabel(s: Pick<PrayerCallSession, "weekday" | "start_time" | "end_time">): string {
  const day = WEEKDAY_LABELS[s.weekday] ?? "";
  const times = !s.end_time
    ? formatTime(s.start_time)
    : `${formatTime(s.start_time, isMorning(s.start_time) !== isMorning(s.end_time))} – ${formatTime(s.end_time)}`;
  return [day, times].filter(Boolean).join(" · ");
}

/**
 * tel: link that dials in and enters the PIN after two DTMF pauses,
 * e.g. "tel:+17705550170,,4412#". Formatting characters are stripped so the
 * link is reliable regardless of how the admin typed the number.
 */
export function telHref(dialIn: string, pin: string | null): string {
  const digits = dialIn.replace(/[^\d+]/g, "");
  const pinDigits = pin ? pin.replace(/[^\d#*]/g, "") : "";
  return pinDigits ? `tel:${digits},,${pinDigits}` : `tel:${digits}`;
}

/**
 * The next start of a weekly session, read as wall-clock time in `zone`, the
 * church's zone; today counts if the start time is still ahead there.
 */
export function nextOccurrence(
  weekday: number,
  time: string,
  zone: string,
  from: Date = new Date()
): Date {
  const [h, m] = time.split(":").map(Number);
  const now = DateTime.fromJSDate(from, { zone });
  const today = now.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  // Luxon numbers Monday 1 … Sunday 7; sessions number Sunday 0 … Saturday 6.
  let daysAhead = (weekday - (today.weekday % 7) + 7) % 7;
  if (daysAhead === 0 && today <= now) daysAhead = 7;
  return today.plus({ days: daysAhead }).toJSDate();
}

/** The end of a session that starts at `start`, on the next day when it is not after the start. */
export function sessionEnd(start: Date, endTime: string, zone: string): Date {
  const [h, m] = endTime.split(":").map(Number);
  const begin = DateTime.fromJSDate(start, { zone });
  const end = begin.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  return (end <= begin ? end.plus({ days: 1 }) : end).toJSDate();
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

/** A prayer_call_sessions row with the same fallbacks as toWallRow(). */
export function toCallSession(raw: Record<string, unknown>): PrayerCallSession {
  const weekday = typeof raw.weekday === "number" ? raw.weekday : -1;
  return {
    id: text(raw.id),
    group_id: text(raw.group_id),
    weekday,
    start_time: text(raw.start_time),
    end_time: textOrNull(raw.end_time),
    leader_id: textOrNull(raw.leader_id),
    dial_in: textOrNull(raw.dial_in),
    pin: textOrNull(raw.pin),
    join_url: textOrNull(raw.join_url),
    event_id: textOrNull(raw.event_id),
    display_order: count(raw.display_order),
    created_at: text(raw.created_at),
    updated_at: text(raw.updated_at),
  };
}
