import { randomBytes } from "node:crypto";
import { parsePrayerKeys, type PrayerKeys } from "./crypto";

export const newKey = () => randomBytes(32).toString("base64");

export function testKeys(env: Record<string, string> = {}): PrayerKeys {
  const keys = parsePrayerKeys({ PRAYER_BODY_KEY: newKey(), PRAYER_AUTHOR_KEY: newKey(), ...env });
  if (!keys) throw new Error("test keys did not parse");
  return keys;
}
