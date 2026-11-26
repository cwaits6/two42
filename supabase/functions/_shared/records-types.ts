// The church records types both the app and the nightly refresh use. The app
// re-exports them from lib/integrations/records/types.ts.

/** The address and key two42 reaches a church's records with. */
export interface RecordsCredentials {
  /** An origin accepted by parseRecordsAddress(). */
  baseUrl: string;
  key: string;
}
