// Read-only calls to a church's Rock through its v1 REST API (OData v3), with
// the church's REST key in the Authorization-Token header. v1 is used rather
// than v2 because v2 needs Rock 17 or later and per-controller grants, and its
// ad-hoc search needs "Unrestricted Read", which skips Rock's own security.
//
// Every call is a GET: two42 never writes to Rock.

export interface RockCredentials {
  /** An origin accepted by parseRockAddress(). */
  baseUrl: string;
  restKey: string;
}

export type RockFailure = "unauthorized" | "unreachable" | "not_rock" | "rejected";

export class RockError extends Error {
  constructor(
    readonly kind: RockFailure,
    readonly status?: number,
  ) {
    super(`Rock request failed: ${kind}${status ? ` (${status})` : ""}`);
  }
}

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

type FetchLike = typeof fetch;

async function getJson(creds: RockCredentials, path: string, query: Record<string, string>, fetcher: FetchLike) {
  const url = new URL(path, creds.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { "Authorization-Token": creds.restKey, Accept: "application/json" },
      // A redirect could carry the key's request to an address parseRockAddress() never saw.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RockError("unreachable");
  }
  if (response.status === 401 || response.status === 403) throw new RockError("unauthorized", response.status);
  if (!response.ok) throw new RockError("rejected", response.status);
  if (!(response.headers.get("content-type") ?? "").includes("json")) throw new RockError("not_rock", response.status);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new RockError("not_rock", response.status);
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
export async function checkConnection(creds: RockCredentials, fetcher: FetchLike = fetch): Promise<void> {
  const body = await getJson(creds, "/api/People", { $top: "1", $select: "Id" }, fetcher);
  if (!Array.isArray(body)) throw new RockError("not_rock");
}

export interface PersonFilterIds {
  recordTypePerson: number;
  recordStatusInactive: number | null;
}

/** The install's ids for the defined values matching relies on. */
export async function definedValueIds(creds: RockCredentials, fetcher: FetchLike = fetch): Promise<PersonFilterIds> {
  const guids = Object.values(ROCK_GUIDS);
  const body = await getJson(
    creds,
    "/api/DefinedValues",
    { $filter: guids.map((g) => `Guid eq guid'${g}'`).join(" or "), $select: "Id,Guid" },
    fetcher,
  );
  if (!Array.isArray(body)) throw new RockError("not_rock");
  const byGuid = new Map<string, number>();
  for (const row of body) {
    if (typeof row !== "object" || row === null) continue;
    const { Id, Guid } = row as Record<string, unknown>;
    const id = int(Id);
    if (id && typeof Guid === "string") byGuid.set(Guid.toLowerCase(), id);
  }
  const recordTypePerson = byGuid.get(ROCK_GUIDS.recordTypePerson);
  if (!recordTypePerson) throw new RockError("not_rock");
  return { recordTypePerson, recordStatusInactive: byGuid.get(ROCK_GUIDS.recordStatusInactive) ?? null };
}

const PAGE = 500;
const NAMES_PER_REQUEST = 15;
// A last name shared by more people than this in one Rock is skipped rather than paged through.
const MAX_PAGES = 4;

/**
 * Living Rock people (not businesses or nameless records, and not inactive)
 * with any of these last names. Rock compares case-insensitively.
 */
export async function peopleByLastName(
  creds: RockCredentials,
  ids: PersonFilterIds,
  lastNames: readonly string[],
  fetcher: FetchLike = fetch,
): Promise<RockPerson[]> {
  const unique = [...new Set(lastNames.map((n) => n.trim()).filter(Boolean))];
  const found = new Map<number, RockPerson>();
  for (let i = 0; i < unique.length; i += NAMES_PER_REQUEST) {
    const names = unique.slice(i, i + NAMES_PER_REQUEST);
    const clauses = [
      `(${names.map((n) => `LastName eq ${odataString(n)}`).join(" or ")})`,
      "IsDeceased eq false",
      `RecordTypeValueId eq ${ids.recordTypePerson}`,
    ];
    if (ids.recordStatusInactive) clauses.push(`RecordStatusValueId ne ${ids.recordStatusInactive}`);
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
      if (!Array.isArray(body)) throw new RockError("not_rock");
      for (const row of body) {
        const person = parsePerson(row);
        if (person) found.set(person.id, person);
      }
      if (body.length < PAGE) break;
    }
  }
  return [...found.values()];
}

const IDS_PER_REQUEST = 50;

/** The Rock people with these ids that exist; a missing id is left out. */
export async function peopleByIds(
  creds: RockCredentials,
  ids: readonly number[],
  fetcher: FetchLike = fetch,
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
    if (!Array.isArray(body)) throw new RockError("not_rock");
    for (const row of body) {
      const person = parsePerson(row);
      if (person && chunk.includes(person.id)) found.push(person);
    }
  }
  return found;
}
