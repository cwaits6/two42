// Read-only calls to a church's Rock through its v1 REST API (OData v3), with
// the church's REST key in the Authorization-Token header. v1 is used rather
// than v2 because v2 needs Rock 17 or later and per-controller grants, and its
// ad-hoc search needs "Unrestricted Read", which skips Rock's own security.
//
// Every call is a GET: two42 never writes to Rock.
import { RecordsError } from "./records-errors.ts";
import { safeFetch } from "./records-fetch.ts";
import type { RecordsCredentials } from "./records-types.ts";

/** A Rock person, holding only what matching needs. Rock's phone, address and family data are never requested. */
export interface RockPerson {
  id: number;
  firstName: string;
  nickName: string;
  lastName: string;
  email: string;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  recordTypeValueId: number | null;
  recordStatusValueId: number | null;
  isDeceased: boolean;
}

export const PERSON_FIELDS = [
  "Id",
  "FirstName",
  "NickName",
  "LastName",
  "Email",
  "BirthMonth",
  "BirthDay",
  "BirthYear",
  "RecordTypeValueId",
  "RecordStatusValueId",
  "IsDeceased",
] as const;

/** Rock's stock defined values. Their ids differ between installs, so they are looked up by Guid. */
export const ROCK_GUIDS = {
  recordTypePerson: "36cf10d6-c695-413d-8e7c-4546efef385e",
  recordStatusInactive: "1dad99d5-41a9-4865-8366-f269902b80a4",
} as const;

const TIMEOUT_MS = 10_000;

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

async function getJson(creds: RecordsCredentials, path: string, query: Record<string, string>, fetcher: FetchLike) {
  const url = new URL(path, creds.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { "Authorization-Token": creds.key, Accept: "application/json" },
      // A redirect could carry the key's request to an address the address check never saw.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RecordsError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new RecordsError("unauthorized", response.status);
  if (!response.ok) throw new RecordsError("rejected", response.status);
  if (!(response.headers.get("content-type") ?? "").includes("json")) throw new RecordsError("not_provider", response.status);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new RecordsError("not_provider", response.status);
  }
}

/** An OData v3 string literal. */
export function odataString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

export function parsePerson(value: unknown): RockPerson | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const id = int(row.Id);
  if (!id) return null;
  return {
    id,
    firstName: text(row.FirstName),
    nickName: text(row.NickName),
    lastName: text(row.LastName),
    email: text(row.Email),
    birthMonth: int(row.BirthMonth),
    birthDay: int(row.BirthDay),
    birthYear: int(row.BirthYear),
    recordTypeValueId: int(row.RecordTypeValueId),
    recordStatusValueId: int(row.RecordStatusValueId),
    isDeceased: row.IsDeceased === true,
  };
}

/**
 * Proves the address is a Rock and the key can read people. Rock answers a
 * key without that permission with 401, the same as a wrong key.
 */
export async function checkConnection(creds: RecordsCredentials, fetcher: FetchLike = safeFetch): Promise<void> {
  const body = await getJson(creds, "/api/People", { $top: "1", $select: "Id" }, fetcher);
  if (!Array.isArray(body)) throw new RecordsError("not_provider");
}

export interface PersonFilterIds {
  recordTypePerson: number;
  recordStatusInactive: number | null;
}

/** The install's ids for the defined values matching relies on. */
export async function definedValueIds(creds: RecordsCredentials, fetcher: FetchLike = safeFetch): Promise<PersonFilterIds> {
  const guids = Object.values(ROCK_GUIDS);
  const body = await getJson(
    creds,
    "/api/DefinedValues",
    { $filter: guids.map((g) => `Guid eq guid'${g}'`).join(" or "), $select: "Id,Guid" },
    fetcher,
  );
  if (!Array.isArray(body)) throw new RecordsError("not_provider");
  const byGuid = new Map<string, number>();
  for (const row of body) {
    if (typeof row !== "object" || row === null) continue;
    const { Id, Guid } = row as Record<string, unknown>;
    const id = int(Id);
    if (id && typeof Guid === "string") byGuid.set(Guid.toLowerCase(), id);
  }
  const recordTypePerson = byGuid.get(ROCK_GUIDS.recordTypePerson);
  if (!recordTypePerson) throw new RecordsError("not_provider");
  return { recordTypePerson, recordStatusInactive: byGuid.get(ROCK_GUIDS.recordStatusInactive) ?? null };
}

const PAGE = 500;
const NAMES_PER_REQUEST = 15;
// A last name shared by more people than this in one Rock isn't paged through;
// the caller is told which names were cut short.
const MAX_PAGES = 4;

/**
 * The spellings of a last name to ask Rock for. Rock compares names exactly
 * (apart from case), while matching ignores punctuation, so "OBrien" in two42
 * has to ask for "O'Brien" too. At most four, so a batch stays bounded.
 */
export function lastNameVariants(name: string): string[] {
  const base = name.trim().replace(/\s+/g, " ");
  if (!base) return [];
  const variants = new Set([base]);
  const stripped = base.replace(/[^\p{L}\p{N}]/gu, "");
  if (stripped) variants.add(stripped);
  if (base.includes("-")) variants.add(base.replace(/-/g, " "));
  if (base.includes(" ")) variants.add(base.replace(/ /g, "-"));
  if (/^[od][a-z]{2,}$/i.test(base)) variants.add(`${base[0]}'${base.slice(1)}`);
  return [...variants].slice(0, 4);
}

export interface PeopleByLastName {
  people: RockPerson[];
  /** Last names, as given, whose batch had more people than two42 reads, so some may be missing. */
  truncated: string[];
}

/**
 * Living Rock people (not businesses or nameless records, and not inactive)
 * with any of these last names, in any spelling lastNameVariants() gives.
 * Rock compares case-insensitively.
 */
export async function peopleByLastName(
  creds: RecordsCredentials,
  ids: PersonFilterIds,
  lastNames: readonly string[],
  fetcher: FetchLike = safeFetch,
): Promise<PeopleByLastName> {
  const originals = [...new Set(lastNames.map((n) => n.trim()).filter(Boolean))];
  const spellings: { original: string; spelling: string }[] = [];
  const seen = new Set<string>();
  for (const original of originals) {
    for (const spelling of lastNameVariants(original)) {
      const key = spelling.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      spellings.push({ original, spelling });
    }
  }
  const found = new Map<number, RockPerson>();
  const truncated = new Set<string>();
  for (let i = 0; i < spellings.length; i += NAMES_PER_REQUEST) {
    const batch = spellings.slice(i, i + NAMES_PER_REQUEST);
    const clauses = [
      `(${batch.map((b) => `LastName eq ${odataString(b.spelling)}`).join(" or ")})`,
      "IsDeceased eq false",
      `RecordTypeValueId eq ${ids.recordTypePerson}`,
    ];
    if (ids.recordStatusInactive) clauses.push(`RecordStatusValueId ne ${ids.recordStatusInactive}`);
    let complete = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await getJson(
        creds,
        "/api/People",
        {
          $filter: clauses.join(" and "),
          $select: PERSON_FIELDS.join(","),
          $orderby: "Id",
          $top: String(PAGE),
          $skip: String(page * PAGE),
        },
        fetcher,
      );
      if (!Array.isArray(body)) throw new RecordsError("not_provider");
      for (const row of body) {
        const person = parsePerson(row);
        if (person) found.set(person.id, person);
      }
      if (body.length < PAGE) {
        complete = true;
        break;
      }
    }
    if (!complete) for (const b of batch) truncated.add(b.original);
  }
  return { people: [...found.values()], truncated: [...truncated] };
}

const IDS_PER_REQUEST = 50;

/** The Rock people with these ids that exist; a missing id is left out. */
export async function peopleByIds(
  creds: RecordsCredentials,
  ids: readonly number[],
  fetcher: FetchLike = safeFetch,
): Promise<RockPerson[]> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  const found: RockPerson[] = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + IDS_PER_REQUEST);
    const body = await getJson(
      creds,
      "/api/People",
      {
        $filter: chunk.map((id) => `Id eq ${id}`).join(" or "),
        $select: PERSON_FIELDS.join(","),
        $top: String(chunk.length),
      },
      fetcher,
    );
    if (!Array.isArray(body)) throw new RecordsError("not_provider");
    for (const row of body) {
      const person = parsePerson(row);
      if (person && chunk.includes(person.id)) found.push(person);
    }
  }
  return found;
}
