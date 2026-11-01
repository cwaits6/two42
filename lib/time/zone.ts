// Pure time-zone helpers. Every function takes the zone explicitly so a
// server in UTC, a browser in Tokyo and a test under any TZ= all produce the
// org's wall-clock time. No server imports: client components use these too.

import { DateTime } from "luxon";

const LOCALE = "en-US";

/**
 * A zone this runtime's Intl can format in. The database is the gate on what
 * gets stored (an exact IANA name); this accepts everything it stores plus
 * what Intl tolerates on its own, so a stored zone is never refused on read.
 */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** An instant read in `zone`. */
export function zoned(iso: string, zone: string): DateTime {
  return DateTime.fromISO(iso, { zone, locale: LOCALE });
}

/**
 * A datetime-local value (`YYYY-MM-DDTHH:mm`) read as wall-clock time in
 * `zone`, as the UTC ISO string the database stores. A time inside a
 * spring-forward gap moves ahead to the first valid minute; an autumn
 * repeat takes its first occurrence.
 */
export function localToUTCISO(local: string, zone: string): string {
  const dt = zoned(local, zone);
  if (!dt.isValid) throw new RangeError(`Not a datetime-local value in ${zone}: ${local}`);
  // Luxon picks between the two using the zone's offset when it's called, so its answer varies by season.
  const earliest = Math.min(...dt.getPossibleOffsets().map((candidate) => candidate.toMillis()));
  return new Date(earliest).toISOString();
}

/** The datetime-local value (`YYYY-MM-DDTHH:mm`) that shows an instant's wall-clock time in `zone`. */
export function isoToLocalInput(iso: string, zone: string): string {
  return zoned(iso, zone).toFormat("yyyy-LL-dd'T'HH:mm");
}

/** An instant formatted in `zone` with Intl options, always en-US. */
export function formatInZone(iso: string, zone: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString(LOCALE, { ...options, timeZone: zone });
}

/** "7:00 PM" */
export function formatEventTime(iso: string, zone: string): string {
  return formatInZone(iso, zone, { hour: "numeric", minute: "2-digit" });
}

/** "Tuesday, September 29, 2026" */
export function formatEventDate(iso: string, zone: string): string {
  return formatInZone(iso, zone, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "7:00 PM – 8:30 PM", or the start alone without an end. */
export function formatEventRange(startIso: string, endIso: string | null, zone: string): string {
  const start = formatEventTime(startIso, zone);
  return endIso ? `${start} – ${formatEventTime(endIso, zone)}` : start;
}

/** The calendar date in `zone` as "YYYY-MM-DD", the key that buckets events into days. */
export function dayKey(iso: string, zone: string): string {
  return zoned(iso, zone).toISODate() ?? "";
}

/**
 * "today", "tomorrow", "in N days", or the weekday, by calendar day in `zone`.
 * Tomorrow is the next calendar date, not now + 24 h, which lands on the same
 * date on the autumn change-over day.
 */
export function relativeDay(startIso: string, zone: string, now: Date = new Date()): string {
  const startKey = dayKey(startIso, zone);
  const todayKey = dayKey(now.toISOString(), zone);
  if (startKey === todayKey) return "today";
  const tomorrowKey = zoned(todayKey, zone).plus({ days: 1 }).toISODate();
  if (startKey === tomorrowKey) return "tomorrow";
  const days = Math.round((Date.parse(startKey) - Date.parse(todayKey)) / (24 * 60 * 60 * 1000));
  return days > 1 ? `in ${days} days` : formatInZone(startIso, zone, { weekday: "long" });
}
