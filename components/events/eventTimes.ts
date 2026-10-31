import { DateTime } from "luxon";

/**
 * The org's zone as people say it, e.g. "Central Time", with the IANA name
 * when the runtime has no friendlier one.
 */
export function zoneName(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  return part && !/^GMT/.test(part) ? part : timeZone.replace(/_/g, " ");
}

/** The next whole hour on the org's clock, as a datetime-local value: a new event's default start. */
export function nextWholeHour(timeZone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now, { zone: timeZone })
    .startOf("hour")
    .plus({ hours: 1 })
    .toFormat("yyyy-MM-dd'T'HH:mm");
}
