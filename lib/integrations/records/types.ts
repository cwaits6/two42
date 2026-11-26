// What two42 needs from a church's records, whichever software keeps them.

import type { RecordsCredentials } from "@/supabase/functions/_shared/records-types";

export type { RecordsCredentials };

/** A person in the church's records, holding only what matching needs. */
export interface RecordsPerson {
  /** The provider's own id for the person. */
  id: string;
  firstName: string;
  nickName: string;
  lastName: string;
  email: string;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  /** Whether two42 may link to this record: a living person, not a business or an inactive record. */
  linkable: boolean;
}

export interface PeopleFound {
  people: RecordsPerson[];
  /**
   * Normalized last names (normalizeName()) whose people couldn't all be read,
   * so a competing candidate may be missing from `people`.
   */
  incompleteLastNames: Set<string>;
}

/** One kind of church records two42 can read. Every call only reads. */
export interface RecordsProvider {
  id: RecordsProviderId;
  /** The product's name, shown to church admins only. */
  label: string;
  /** Proves the address is this provider and the key can read people. */
  checkConnection(creds: RecordsCredentials): Promise<void>;
  /** People who are linkable and have one of these last names. */
  findByLastNames(creds: RecordsCredentials, lastNames: readonly string[]): Promise<PeopleFound>;
  /** The people with these ids that exist, linkable or not; a missing id is left out. */
  findByIds(creds: RecordsCredentials, ids: readonly string[]): Promise<RecordsPerson[]>;
  /** Where a church admin opens the person in the provider's own app. */
  personUrl(baseUrl: string, id: string): string;
}

export type RecordsProviderId = "rock";
