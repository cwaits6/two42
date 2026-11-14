import { existsSync } from "node:fs";
import { parsePrayerKeys, type PrayerKeys } from "../../lib/prayer/crypto";

/**
 * The keys the app under test seals with, so a spec can read what it stored.
 * Locally they come from .env.local, which Next loads for the server but
 * Playwright does not; in CI the job sets them in the environment.
 */
export function prayerKeys(): PrayerKeys {
  // loadEnvFile never overwrites a variable already set, so the environment still wins.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const keys = parsePrayerKeys(process.env);
  if (!keys) throw new Error("Set PRAYER_BODY_KEY and PRAYER_AUTHOR_KEY for the app under test");
  return keys;
}
