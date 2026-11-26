// The church records types both the app and the nightly refresh use. The app
// re-exports them from lib/integrations/records/types.ts.

/** The address and key two42 reaches a church's records with. */
export interface RecordsCredentials {
  /** An origin accepted by parseRecordsAddress(). */
  baseUrl: string;
  key: string;
}

/** A phone number as the records hold it, before two42 normalizes it. */
export interface RecordsPhone {
  countryCode: string;
  number: string;
}

export interface RecordsDate {
  month: number | null;
  day: number | null;
  year: number | null;
}

/**
 * A person in the church's records with every value two42 may copy, and
 * nothing else: no email, no unlisted phone, no texting flag, no connection
 * status and no church-defined field.
 */
export interface RecordsCopyPerson {
  /** The provider's own id for the person, as stored in records_person_links. */
  id: string;
  firstName: string;
  lastName: string;
  nickName: string;
  title: string | null;
  suffix: string | null;
  gender: "male" | "female" | null;
  mobile: RecordsPhone | null;
  work: RecordsPhone | null;
  birthday: RecordsDate;
  anniversary: RecordsDate;
  graduationYear: number | null;
  /** The provider's token for the person's photo, or null when there is none. */
  photo: string | null;
}

export type RecordsPresence = "active" | "inactive";

export interface RecordsChanges {
  /** Ids of people changed since the mark passed in. */
  ids: string[];
  /**
   * The mark to pass next time, once every id has been handled. A provider
   * that couldn't read every change in one go returns a mark from part way, so
   * the next run reads on from there.
   */
  cursor: string;
}

/** What a provider offers for copying people's details into two42. Every call only reads. */
export interface RecordsCopySource {
  /** People changed since `cursor`. With no cursor nobody is returned, only the mark to start from. */
  changedSince(creds: RecordsCredentials, cursor: string | null): Promise<RecordsChanges>;
  /** These people with every copyable value; an id the records don't have is left out. */
  peopleForCopy(creds: RecordsCredentials, ids: readonly string[]): Promise<RecordsCopyPerson[]>;
  /** Which of these ids still exist, and whether each is active. An id that doesn't is left out. */
  presence(creds: RecordsCredentials, ids: readonly string[]): Promise<Map<string, RecordsPresence>>;
  /**
   * The photo as a JPEG no larger than maxEdge on its longer side, or null when the records have no usable one.
   * Throws when the records can't be reached or fail, so the person is tried again rather than left without it.
   */
  photo(creds: RecordsCredentials, token: string, maxEdge: number): Promise<Uint8Array | null>;
}
