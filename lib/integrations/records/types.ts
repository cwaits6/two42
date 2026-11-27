// What two42 needs from a church's records, whichever software keeps them.

import type {
  RecordsAddress,
  RecordsCopySource,
  RecordsCredentials,
  RecordsDate,
} from "@/supabase/functions/_shared/records-types";

export type {
  RecordsAddress,
  RecordsChild,
  RecordsCopyPerson,
  RecordsCopySource,
  RecordsCredentials,
  RecordsFamily,
  RecordsFamilyMember,
  RecordsHouseholdSource,
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

/** A person's details two42 shows live and never stores. Never a birth year. */
export interface RecordsLivePerson {
  birthday: { month: number | null; day: number | null };
  anniversary: RecordsDate;
  graduationYear: number | null;
}

export interface RecordsLiveDetails {
  /** By the provider's person id. */
  people: Map<string, RecordsLivePerson>;
  /** Each family's home address, by the provider's family id; null when it has none. */
  families: Map<string, RecordsAddress | null>;
}

/** Reading the details two42 shows live and never stores. Every call only reads. */
export interface RecordsLiveSource {
  /** These people's and families' details, in as few requests as the provider allows; an id the records don't have is left out. */
  details(
    creds: RecordsCredentials,
    request: { people: readonly string[]; families: readonly string[] },
  ): Promise<RecordsLiveDetails>;
}

/** One kind of church records two42 can read. Every call only reads. */
export interface RecordsProvider {
  id: RecordsProviderId;
  /** The product's name, shown to church admins only. */
  label: string;
  connect: RecordsConnectStep;
  /** Copying people's details into two42, for a provider that offers it. */
  copy?: RecordsCopySource;
  /** Showing details live from the records instead of copying them, for a provider that offers it. */
  live?: RecordsLiveSource;
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
