import { formatInZone } from "@/lib/time/zone";

/** "Good morning" / "Good afternoon" / "Good evening" on the org's wall clock. */
export function greeting(timeZone: string, now: Date = new Date()): string {
  const h = Number(formatInZone(now.toISOString(), timeZone, { hour: "numeric", hourCycle: "h23" }));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "Saturday, November 1" on the org's wall clock. */
export function todayLabel(timeZone: string, now: Date = new Date()): string {
  return formatInZone(now.toISOString(), timeZone, { weekday: "long", month: "long", day: "numeric" });
}

/** The viewer's own name for the greeting, or null when the profile has none. */
export function greetingName(
  profile: { preferred_name?: string | null; first_name?: string | null } | null
): string | null {
  return profile?.preferred_name?.trim() || profile?.first_name?.trim() || null;
}
