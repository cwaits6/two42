// The sealing scheme lives once in the edge functions' shared folder, because
// the nightly refresh opens the same keys there.
import { parseRecordsSecret, RECORDS_SECRET_ENV } from "@/supabase/functions/_shared/records-crypto";

export {
  openKey,
  parseRecordsSecret,
  RECORDS_SECRET_ENV,
  RecordsCryptoError,
  sealKey,
} from "@/supabase/functions/_shared/records-crypto";

/** The secret from the server environment, or null when it is missing or malformed. */
export function loadRecordsSecret(): Buffer | null {
  return parseRecordsSecret(process.env[RECORDS_SECRET_ENV]);
}
