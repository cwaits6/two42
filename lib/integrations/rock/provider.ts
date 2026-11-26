// Rock RMS as a source of church records.
import { normalizeName } from "@/lib/integrations/records/match";
import type { RecordsCredentials, RecordsPerson, RecordsProvider } from "@/lib/integrations/records/types";
import { rockCopySource } from "@/supabase/functions/_shared/rock-copy";
import { rockHouseholdSource } from "@/supabase/functions/_shared/rock-households";
import {
  checkConnection,
  definedValueIds,
  peopleByIds,
  peopleByLastName,
  type PersonFilterIds,
  type RockPerson,
} from "./client";

/** Whether Rock's record is one two42 may link: a living person, not a business or an inactive record. */
export function linkable(person: RockPerson, ids: PersonFilterIds): boolean {
  if (person.isDeceased) return false;
  if (person.recordTypeValueId !== ids.recordTypePerson) return false;
  return ids.recordStatusInactive === null || person.recordStatusValueId !== ids.recordStatusInactive;
}

export function toRecordsPerson(person: RockPerson, ids: PersonFilterIds): RecordsPerson {
  return {
    id: String(person.id),
    firstName: person.firstName,
    nickName: person.nickName,
    lastName: person.lastName,
    email: person.email,
    birthMonth: person.birthMonth,
    birthDay: person.birthDay,
    birthYear: person.birthYear,
    linkable: linkable(person, ids),
  };
}

// Rock's person ids are positive integers; anything else can't be one.
const ROCK_ID = /^[1-9][0-9]{0,9}$/;

export const rockProvider: RecordsProvider = {
  id: "rock",
  label: "Rock RMS",
  connect: {
    addressLabel: "Rock RMS address",
    addressPlaceholder: "https://rock.yourchurch.org",
    keyLabel: "REST key",
    keyHelp:
      "In Rock, add a REST key under Admin Tools, Settings, REST Keys. Give its user a security role of its own that can only view the People, PhoneNumbers, DefinedValues, Groups, GroupMembers and Locations REST controllers, with no edit rights. The key isn't shown again after you save it.",
  },
  copy: { ...rockCopySource(), households: rockHouseholdSource() },
  checkConnection: (creds: RecordsCredentials) => checkConnection(creds),
  async findByLastNames(creds, lastNames) {
    const ids = await definedValueIds(creds);
    const { people, truncated } = await peopleByLastName(creds, ids, lastNames);
    return {
      people: people.map((p) => toRecordsPerson(p, ids)),
      incompleteLastNames: new Set(truncated.map(normalizeName)),
    };
  },
  async findByIds(creds, personIds) {
    const numeric = personIds.filter((id) => ROCK_ID.test(id)).map(Number);
    if (numeric.length === 0) return [];
    const ids = await definedValueIds(creds);
    return (await peopleByIds(creds, numeric)).map((p) => toRecordsPerson(p, ids));
  },
  personUrl: (baseUrl, id) => `${baseUrl}/Person/${encodeURIComponent(id)}`,
};
