import { loadRecordsSecret } from "./crypto";

/** On only where RECORDS_KEY_SECRET is set, so a deployment without it shows no trace of church records. */
export function recordsIntegrationEnabled(): boolean {
  return loadRecordsSecret() !== null;
}
