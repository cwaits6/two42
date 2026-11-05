/**
 * The serving reminder send time as the settings dialog shows it. The hour
 * is a whole hour in the church's time zone; the hourly job in
 * supabase/functions/_shared/serving-due.ts reads the same constants, and a
 * test on each side checks they agree.
 */

export const DEFAULT_SEND_HOUR = 9;
export const FIRST_SEND_HOUR = 6;
export const LAST_SEND_HOUR = 21;

/** "9:00 AM" */
export function formatSendHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

/** Every hour a team can choose, first to last. */
export const SEND_HOUR_OPTIONS = Array.from(
  { length: LAST_SEND_HOUR - FIRST_SEND_HOUR + 1 },
  (_, i) => FIRST_SEND_HOUR + i
).map((hour) => ({ value: String(hour), label: formatSendHour(hour) }));
