import { createEvents, type EventAttributes } from "ics";
import { EMPTY_CALENDAR } from "@/lib/ics-utils";
import { formatEventDate, formatEventTime } from "@/lib/time/zone";

/** How long a dinner lasts in a calendar: dinners carry no end time. */
export const DINNER_HOURS = 3;

export interface DinnerCalendarEntry {
  dinnerId: string;
  /** UTC ISO instant. */
  startsAt: string;
  seasonTitle: string;
  /** "Henry and Chloe Mockingham", or null while nobody hosts it. */
  hostNames: string | null;
  address: string | null;
}

function utcParts(iso: string): [number, number, number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

export function dinnerTitle(entry: Pick<DinnerCalendarEntry, "seasonTitle" | "hostNames">): string {
  return entry.hostNames ? `${entry.seasonTitle}: dinner at ${entry.hostNames}'s` : `${entry.seasonTitle}: dinner`;
}

export function dinnerToICSAttributes(entry: DinnerCalendarEntry, zone: string): EventAttributes {
  const when = `${formatEventDate(entry.startsAt, zone)} at ${formatEventTime(entry.startsAt, zone)}`;
  return {
    // Stable per dinner, so a moved dinner updates in place on the next refresh.
    uid: `dinner-${entry.dinnerId}@two42`,
    title: dinnerTitle(entry),
    start: utcParts(entry.startsAt),
    startInputType: "utc",
    duration: { hours: DINNER_HOURS },
    status: "CONFIRMED",
    description: [when, entry.hostNames ? `Host: ${entry.hostNames}` : null, entry.address].filter(Boolean).join("\n"),
    ...(entry.address ? { location: entry.address } : {}),
  };
}

/** A calendar of one person's dinners; times shown in the church's zone. */
export function dinnersICS(entries: DinnerCalendarEntry[], zone: string): string {
  if (entries.length === 0) return EMPTY_CALENDAR;
  const { error, value } = createEvents(entries.map((e) => dinnerToICSAttributes(e, zone)));
  if (error || !value) throw new Error("Failed to generate dinner calendar");
  return value;
}

/** One address line from its parts, skipping the empty ones. */
export function formatAddress(a: {
  address_line1: string;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}): string {
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine].filter((part) => part && part.trim()).join(", ");
}
