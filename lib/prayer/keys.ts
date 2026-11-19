import { parsePrayerKeys, type PrayerKeys } from "./crypto";

/**
 * The prayer keys from the server environment, or null when either is missing
 * or malformed. Every caller treats null as its failed state: Preview
 * deployments carry no keys by design.
 */
export function loadPrayerKeys(): PrayerKeys | null {
  return parsePrayerKeys(process.env);
}
