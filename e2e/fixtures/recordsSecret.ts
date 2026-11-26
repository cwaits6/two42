import { existsSync } from "node:fs";

/**
 * Fails when the app under test has no RECORDS_KEY_SECRET, since without it
 * no page shows anything about the church's records. Locally it comes from
 * .env.local, which Next loads for the server but Playwright does not; in CI
 * the job sets it in the environment.
 */
export function requireRecordsSecret(): void {
  // loadEnvFile never overwrites a variable already set, so the environment still wins.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!process.env.RECORDS_KEY_SECRET) throw new Error("Set RECORDS_KEY_SECRET for the app under test");
}
