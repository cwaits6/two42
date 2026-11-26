import { createEvents, type EventAttributes } from "ics";
import { EMPTY_CALENDAR } from "@/lib/ics-utils";
import { formatEventDate, formatEventTime } from "@/lib/time/zone";

export { formatAddress } from "@/supabase/functions/_shared/supper-labels";

/** How long a supper lasts in a calendar: suppers carry no end time. */
export const SUPPER_HOURS = 3;

export interface SupperCalendarEntry {
  supperId: string;
  /** UTC ISO instant. */
  startsAt: string;
  rotationTitle: string;
  /** "Henry and Chloe Mockingham", or null while nobody hosts it. */
  hostNames: string | null;
  address: string | null;
}

function utcParts(iso: string): [number, number, number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
}

export function supperTitle(entry: Pick<SupperCalendarEntry, "rotationTitle" | "hostNames">): string {
  return entry.hostNames ? `${entry.rotationTitle}: supper at ${entry.hostNames}'s` : `${entry.rotationTitle}: supper`;
}

export function supperToICSAttributes(entry: SupperCalendarEntry, zone: string): EventAttributes {
  const when = `${formatEventDate(entry.startsAt, zone)} at ${formatEventTime(entry.startsAt, zone)}`;
  return {
    // Stable per supper, so a moved supper updates in place on the next refresh.
    uid: `supper-${entry.supperId}@two42`,
    title: supperTitle(entry),
    start: utcParts(entry.startsAt),
    startInputType: "utc",
    duration: { hours: SUPPER_HOURS },
    status: "CONFIRMED",
    description: [when, entry.hostNames ? `Host: ${entry.hostNames}` : null, entry.address].filter(Boolean).join("\n"),
    ...(entry.address ? { location: entry.address } : {}),
  };
}

/** A calendar of one person's suppers; times shown in the church's zone. */
export function suppersICS(entries: SupperCalendarEntry[], zone: string): string {
  if (entries.length === 0) return EMPTY_CALENDAR;
  const { error, value } = createEvents(entries.map((e) => supperToICSAttributes(e, zone)));
  if (error || !value) throw new Error("Failed to generate supper calendar");
  return value;
}

