import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatBirthdayShort(month: number, day: number): string {
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

export function formatAnniversary(month: number, day: number, year: number | null): string {
  const monthDay = formatBirthdayShort(month, day);
  return year === null ? monthDay : `${monthDay}, ${year}`;
}

/** Whose number the household phone is: the spouse it points at, or the home's own. */
export function householdPhoneLabel(
  family: Pick<FamilyDirectoryFull, "phone_profile_id" | "members">,
): string {
  const owner = family.members.find((m) => m.id === family.phone_profile_id);
  const name = owner?.preferred_name || owner?.first_name;
  return name ? `${name}'s mobile` : "home";
}

export function relLabel(rel: string): string {
  switch (rel) {
    case "primary": return "Primary";
    case "spouse": return "Spouse";
    case "child": return "Child";
    case "parent": return "Parent";
    case "sibling": return "Sibling";
    default: return "Other";
  }
}

/** Resolve the best address to show in the detail sheet */
export function resolveAddress(
  member: DirectoryProfile,
  family: FamilyDirectoryFull | null,
) {
  const line1 = member.address_line1 ?? family?.address_line1 ?? null;
  const line2 = member.address_line2 ?? family?.address_line2 ?? null;
  const city = member.city ?? family?.city ?? null;
  const state = member.state ?? family?.state ?? null;
  const postal = member.postal_code ?? family?.postal_code ?? null;
  if (!line1 && !city) return null;
  return { line1, line2, city, state, postal };
}

export function downloadVCard(profileId: string) {
  // Not a page navigation: the route replies `Content-Disposition: attachment`,
  // so the browser downloads the .vcf and stays put. Router navigation cannot
  // trigger a download, so the rule's suggested fix does not apply here.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `/api/members/${profileId}/vcard`;
}

/** Local midnight of a "YYYY-MM-DD" date, so the helpers below count whole calendar days in any runtime zone */
export function calendarDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Days until the next occurrence of a recurring month/day date */
export function daysUntilNextOccurrence(month: number, day: number, today: Date): number {
  return Math.round(
    (nextOccurrence(month, day, today).getTime() - today.getTime()) / 86400000,
  );
}

/** The calendar date a recurring month/day date falls on this year, passed or not */
export function occurrenceThisYear(month: number, day: number, today: Date): Date {
  return new Date(today.getFullYear(), month - 1, day);
}

/** The next calendar date a recurring month/day date falls on */
export function nextOccurrence(month: number, day: number, today: Date): Date {
  const thisYear = occurrenceThisYear(month, day, today);
  return thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
}

/** Whether a recurring month/day date falls in today's calendar month this year */
export function isInCurrentMonth(month: number, day: number, today: Date): boolean {
  return occurrenceThisYear(month, day, today).getMonth() === today.getMonth();
}

/**
 * "Friday, July 11" — a date in the current month keeps this year's weekday
 * even once it has passed, because the row sits in this month's list. Any
 * other date shows its next occurrence.
 */
export function formatOccurrence(month: number, day: number, today: Date): string {
  const date = isInCurrentMonth(month, day, today)
    ? occurrenceThisYear(month, day, today)
    : nextOccurrence(month, day, today);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** Month numbers (1-12) starting at the current month and wrapping the year */
export function monthCycle(currentMonth: number): number[] {
  return Array.from({ length: 12 }, (_, i) => ((currentMonth - 1 + i) % 12) + 1);
}

/** "Today", "Tomorrow", or "In N days" for the upcoming-soon pill */
export function formatDaysUntil(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
