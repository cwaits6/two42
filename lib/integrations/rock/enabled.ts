import { loadRockSecret } from "./crypto";

/** On only where ROCK_KEY_SECRET is set, so a deployment without it shows no trace of Rock. */
export function rockIntegrationEnabled(): boolean {
  return loadRockSecret() !== null;
}
