import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatBirthdayShort(month: number, day: number): string {
  return `${MONTH_NAMES[month - 1]} ${day}`;
}

export function formatAnniversary(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

/** Days until the next occurrence of a recurring month/day date */
export function daysUntilNextOccurrence(month: number, day: number, today: Date): number {
  return Math.round(
    (nextOccurrence(month, day, today).getTime() - today.getTime()) / 86400000,
  );
}

/** The next calendar date a recurring month/day date falls on */
export function nextOccurrence(month: number, day: number, today: Date): Date {
  const year = today.getFullYear();
  const thisYear = new Date(year, month - 1, day);
  return thisYear >= today ? thisYear : new Date(year + 1, month - 1, day);
}

/** "Friday, July 11" — weekday and date of the next occurrence */
export function formatNextOccurrence(month: number, day: number, today: Date): string {
  return nextOccurrence(month, day, today).toLocaleDateString("en-US", {
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
