// The sealing scheme lives once in the edge functions' shared folder, because
// the nightly refresh opens the same keys there.
import { logError } from "@/lib/log";
import { parseRecordsSecrets, type RecordsSecretEnv, type RecordsSecrets } from "@/supabase/functions/_shared/records-crypto";

export {
  intakeKeyLabel,
  openKey,
  parseRecordsSecret,
  parseRecordsSecrets,
  RECORDS_SECRET_ENV,
  RECORDS_SECRET_PREVIOUS_ENV,
  RecordsCryptoError,
  recordsKeyId,
  sealedWithCurrentSecret,
  sealKey,
} from "@/supabase/functions/_shared/records-crypto";
export type { RecordsSecretEnv, RecordsSecrets } from "@/supabase/functions/_shared/records-crypto";

// Read on every request, so a bad value is reported once per server instance.
const reported = new Set<RecordsSecretEnv>();

/**
 * The secrets from the server environment, or null when the current one is
 * missing or either is malformed; a malformed one is logged once.
 */
export function loadRecordsSecret(): RecordsSecrets | null {
  const { secrets, malformed } = parseRecordsSecrets((name) => process.env[name]);
  if (malformed && !reported.has(malformed)) {
    reported.add(malformed);
    if (malformed === "RECORDS_KEY_SECRET") logError("Church records are off: RECORDS_KEY_SECRET is not a valid key");
    else logError("Church records are off: RECORDS_KEY_SECRET_PREVIOUS is not a valid key");
  }
  return secrets;
}
