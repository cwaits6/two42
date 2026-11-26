// What two42 needs from a church's records, whichever software keeps them.

import type { RecordsCopySource, RecordsCredentials } from "@/supabase/functions/_shared/records-types";

export type {
  RecordsCopyPerson,
  RecordsCopySource,
  RecordsCredentials,
  RecordsPresence,
} from "@/supabase/functions/_shared/records-types";

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

/** How a provider asks a church admin to connect it, in that provider's own words. */
export interface RecordsConnectStep {
  addressLabel: string;
  addressPlaceholder: string;
  keyLabel: string;
  /** Where to make the key, and the least it may be allowed to do. */
  keyHelp: string;
}

/** One kind of church records two42 can read. Every call only reads. */
export interface RecordsProvider {
  id: RecordsProviderId;
  /** The product's name, shown to church admins only. */
  label: string;
  connect: RecordsConnectStep;
  /** Copying people's details into two42, for a provider that offers it. */
  copy?: RecordsCopySource;
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
