// Reading families from a church's Rock: each person's primary family, the
// family's active members, its home address and home phone, and, only when the
// church suggests children, each child's name, birthday month and day, grade
// and photo. Every request is a GET with $select naming each field read; a
// birth year, email or any other detail of a child is never asked for, and an
// adult's name is dropped as it is read.
//
// The controllers this reads, People, DefinedValues, GroupMembers, Groups,
// Locations and PhoneNumbers, are the ones listed for the view-only role in
// docs/integrations/church-records.md.
import { RecordsError } from "./records-errors.ts";
import { safeFetch } from "./records-fetch.ts";
import type {
  RecordsAddress,
  RecordsChild,
  RecordsCredentials,
  RecordsFamily,
  RecordsFamilyMember,
  RecordsHouseholdSource,
  RecordsPhone,
} from "./records-types.ts";
import { type FetchLike, getJson, ROCK_GUIDS } from "./rock-client.ts";
import { byIdChunks, IDS_PER_REQUEST, int, PHONE_FIELDS, presenceOf, rockIds, rows, text } from "./rock-copy.ts";

/** Rock's stock defined values for families, looked up by Guid because their ids differ between installs. */
export const ROCK_FAMILY_GUIDS = {
  married: "5fe5a540-7d9f-433e-b47e-4229d1472248",
  homeLocation: "8c52e53c-2a66-435a-ae6e-5ee307d9a0dc",
  homePhone: "aa8732fb-2cea-4c76-8d6d-6aaa2c6a4303",
} as const;

export const FAMILY_OF_FIELDS = ["Id", "PrimaryFamilyId"] as const;
export const MEMBER_FIELDS = ["GroupId", "PersonId", "GroupMemberStatus"] as const;
export const MEMBER_PERSON_FIELDS = [
  "Id",
  "AgeClassification",
  "MaritalStatusValueId",
  "RecordTypeValueId",
  "RecordStatusValueId",
  "IsDeceased",
] as const;
/** Read with a family's members only while the church suggests children. Never BirthYear. */
export const CHILD_FIELDS = ["FirstName", "LastName", "BirthMonth", "BirthDay", "GraduationYear", "PhotoId"] as const;
export const GROUP_LOCATION_FIELDS = [
  "Id",
  "GroupLocations/LocationId",
  "GroupLocations/GroupLocationTypeValueId",
  "GroupLocations/IsMailingLocation",
] as const;
export const LOCATION_FIELDS = ["Id", "Street1", "Street2", "City", "State", "PostalCode", "Country"] as const;

const PAGE = 500;
// Members read per chunk of families; a chunk with more is a records server
// answering something other than families.
const MAX_MEMBER_PAGES = 20;

interface FamilyIds {
  recordTypePerson: number;
  recordStatusInactive: number | null;
  married: number | null;
  homeLocation: number | null;
  homePhone: number | null;
}

async function familyIds(creds: RecordsCredentials, fetcher: FetchLike): Promise<FamilyIds> {
  const guids = [ROCK_GUIDS.recordTypePerson, ROCK_GUIDS.recordStatusInactive, ...Object.values(ROCK_FAMILY_GUIDS)];
  const body = await getJson(
    creds,
    "/api/DefinedValues",
    { $filter: guids.map((g) => `Guid eq guid'${g}'`).join(" or "), $select: "Id,Guid" },
    fetcher,
  );
  const byGuid = new Map<string, number>();
  for (const row of rows(body)) {
    const id = int(row.Id);
    if (id && typeof row.Guid === "string") byGuid.set(row.Guid.toLowerCase(), id);
  }
  const recordTypePerson = byGuid.get(ROCK_GUIDS.recordTypePerson);
  if (!recordTypePerson) throw new RecordsError("not_provider");
  return {
    recordTypePerson,
    recordStatusInactive: byGuid.get(ROCK_GUIDS.recordStatusInactive) ?? null,
    married: byGuid.get(ROCK_FAMILY_GUIDS.married) ?? null,
    homeLocation: byGuid.get(ROCK_FAMILY_GUIDS.homeLocation) ?? null,
    homePhone: byGuid.get(ROCK_FAMILY_GUIDS.homePhone) ?? null,
  };
}

async function familyOf(
  creds: RecordsCredentials,
  personIds: readonly string[],
  fetcher: FetchLike,
): Promise<Map<string, string>> {
  const numeric = rockIds(personIds);
  const found = new Map<string, string>();
  for (const row of numeric.length ? await byIdChunks(creds, "/api/People", "Id", numeric, FAMILY_OF_FIELDS, fetcher) : []) {
    const id = int(row.Id);
    const family = int(row.PrimaryFamilyId);
    if (id && family && numeric.includes(id)) found.set(String(id), String(family));
  }
  return found;
}

const active = (status: unknown) => status === 1 || status === "Active";
const isChild = (classification: unknown) => classification === 2 || classification === "Child";

/** Active members of these families, read a page at a time. */
async function members(
  creds: RecordsCredentials,
  families: readonly number[],
  fetcher: FetchLike,
): Promise<{ groupId: number; personId: number }[]> {
  const found: { groupId: number; personId: number }[] = [];
  for (let i = 0; i < families.length; i += IDS_PER_REQUEST) {
    const chunk = families.slice(i, i + IDS_PER_REQUEST);
    const filter = `(${chunk.map((id) => `GroupId eq ${id}`).join(" or ")}) and IsArchived eq false`;
    for (let page = 0; ; page++) {
      if (page === MAX_MEMBER_PAGES) throw new RecordsError("not_provider");
      const body = rows(
        await getJson(
          creds,
          "/api/GroupMembers",
          {
            $filter: filter,
            $select: MEMBER_FIELDS.join(","),
            $orderby: "Id",
            $top: String(PAGE),
            $skip: String(page * PAGE),
          },
          fetcher,
        ),
      );
      for (const row of body) {
        const groupId = int(row.GroupId);
        const personId = int(row.PersonId);
        if (groupId && personId && chunk.includes(groupId) && active(row.GroupMemberStatus)) {
          found.push({ groupId, personId });
        }
      }
      if (body.length < PAGE) break;
    }
  }
  return found;
}

/** The family's home address: of its home locations, the one marked for mail first, as Rock's own family view picks it. */
function homeLocationIds(groupRows: readonly Record<string, unknown>[], homeType: number | null) {
  const byFamily = new Map<number, number>();
  if (homeType === null) return byFamily;
  for (const row of groupRows) {
    const id = int(row.Id);
    if (!id || !Array.isArray(row.GroupLocations)) continue;
    const homes = row.GroupLocations.filter(
      (l): l is Record<string, unknown> =>
        typeof l === "object" && l !== null && int(l.GroupLocationTypeValueId) === homeType && !!int(l.LocationId),
    );
    const chosen = homes.find((l) => l.IsMailingLocation === true) ?? homes[0];
    if (chosen) byFamily.set(id, int(chosen.LocationId) as number);
  }
  return byFamily;
}

function parseAddress(row: Record<string, unknown>): RecordsAddress {
  return {
    street1: text(row.Street1),
    street2: text(row.Street2),
    city: text(row.City),
    state: text(row.State),
    postalCode: text(row.PostalCode),
    country: text(row.Country),
  };
}

/** Each family's home address, by family id, read from the groups' GroupLocations; null for a family with none. */
export async function homeAddresses(
  creds: RecordsCredentials,
  groupRows: readonly Record<string, unknown>[],
  homeType: number | null,
  fetcher: FetchLike,
): Promise<Map<number, RecordsAddress | null>> {
  const homes = homeLocationIds(groupRows, homeType);
  const locationIds = [...new Set(homes.values())];
  const locations = new Map<number, RecordsAddress>();
  for (const row of locationIds.length
    ? await byIdChunks(creds, "/api/Locations", "Id", locationIds, LOCATION_FIELDS, fetcher)
    : []) {
    const id = int(row.Id);
    if (id && locationIds.includes(id)) locations.set(id, parseAddress(row));
  }
  const addresses = new Map<number, RecordsAddress | null>();
  for (const [family, location] of homes) addresses.set(family, locations.get(location) ?? null);
  return addresses;
}

async function families(
  creds: RecordsCredentials,
  ids: readonly string[],
  options: { children: boolean },
  fetcher: FetchLike,
): Promise<RecordsFamily[]> {
  const numeric = rockIds(ids);
  if (numeric.length === 0) return [];
  const valueIds = await familyIds(creds, fetcher);

  const groups = (
    await byIdChunks(creds, "/api/Groups", "Id", numeric, GROUP_LOCATION_FIELDS, fetcher, { $expand: "GroupLocations" })
  ).filter((row) => numeric.includes(int(row.Id) ?? 0));
  if (groups.length === 0) return [];
  const existing = groups.map((row) => int(row.Id) as number);

  const memberRows = await members(creds, existing, fetcher);
  const personIds = [...new Set(memberRows.map((m) => m.personId))];
  const select = options.children ? [...MEMBER_PERSON_FIELDS, ...CHILD_FIELDS] : MEMBER_PERSON_FIELDS;
  const people = new Map<number, { member: RecordsFamilyMember; child: RecordsChild | null }>();
  for (const row of personIds.length ? await byIdChunks(creds, "/api/People", "Id", personIds, select, fetcher) : []) {
    const id = int(row.Id);
    if (!id || !personIds.includes(id) || presenceOf(row, valueIds) !== "active") continue;
    const adult = !isChild(row.AgeClassification);
    const married = valueIds.married !== null && int(row.MaritalStatusValueId) === valueIds.married;
    const photo = int(row.PhotoId);
    people.set(id, {
      member: { id: String(id), adult, married },
      child: options.children && !adult
        ? {
          id: String(id),
          firstName: text(row.FirstName),
          lastName: text(row.LastName),
          birthday: { month: int(row.BirthMonth), day: int(row.BirthDay) },
          graduationYear: int(row.GraduationYear),
          photo: photo === null ? null : String(photo),
        }
        : null,
    });
  }

  const addresses = await homeAddresses(creds, groups, valueIds.homeLocation, fetcher);

  const adults = [...people.values()].filter((p) => p.member.adult).map((p) => Number(p.member.id)).sort((a, b) => a - b);
  const homePhones = new Map<number, RecordsPhone>();
  if (adults.length && valueIds.homePhone !== null) {
    for (const row of await byIdChunks(creds, "/api/PhoneNumbers", "PersonId", adults, PHONE_FIELDS, fetcher)) {
      const personId = int(row.PersonId);
      const number = text(row.Number).replace(/\D/g, "");
      // An unlisted number is dropped here and never reaches two42.
      if (!personId || !number || row.IsUnlisted !== false || int(row.NumberTypeValueId) !== valueIds.homePhone) continue;
      if (!homePhones.has(personId)) homePhones.set(personId, { countryCode: text(row.CountryCode).replace(/\D/g, ""), number });
    }
  }

  return existing.map((familyId) => {
    const inFamily = [...new Set(memberRows.filter((m) => m.groupId === familyId).map((m) => m.personId))]
      .sort((a, b) => a - b)
      .map((id) => people.get(id))
      .filter((p) => p !== undefined);
    const phoneOwner = inFamily.find((p) => p.member.adult && homePhones.has(Number(p.member.id)));
    return {
      id: String(familyId),
      members: inFamily.map((p) => p.member),
      children: inFamily.flatMap((p) => (p.child ? [p.child] : [])),
      address: addresses.get(familyId) ?? null,
      homePhone: phoneOwner ? homePhones.get(Number(phoneOwner.member.id)) ?? null : null,
    };
  });
}

export function rockHouseholdSource(fetcher: FetchLike = safeFetch): RecordsHouseholdSource {
  return {
    familyOf: (creds, personIds) => familyOf(creds, personIds, fetcher),
    families: (creds, ids, options) => families(creds, ids, options, fetcher),
  };
}
