// Reading the values two42 copies from a church's Rock: people, their listed
// phones, and the defined values that name a title, suffix or phone type. Every
// request is a GET with $select naming each field read, so nothing else, such as
// email, the texting flag, connection status or attributes, is ever asked for.
// A photo comes from Rock's image handler, which resizes it, so two42 never
// decodes an image.
import { RecordsError } from "./records-errors.ts";
import { safeFetch } from "./records-fetch.ts";
import type {
  RecordsChanges,
  RecordsCopyPerson,
  RecordsCopySource,
  RecordsCredentials,
  RecordsDate,
  RecordsPhone,
  RecordsPresence,
} from "./records-types.ts";
import { type FetchLike, getJson, ROCK_GUIDS } from "./rock-client.ts";

/** Rock's stock phone types, looked up by Guid because their ids differ between installs. */
export const ROCK_PHONE_TYPE_GUIDS = {
  mobile: "407e7e45-7b2e-4fcd-9605-ecb1339f2453",
  work: "2cc66d5a-f61c-4b74-9af9-590a9847c13c",
} as const;

export const COPY_PERSON_FIELDS = [
  "Id",
  "FirstName",
  "NickName",
  "LastName",
  "TitleValueId",
  "SuffixValueId",
  "Gender",
  "BirthMonth",
  "BirthDay",
  "BirthYear",
  "AnniversaryDate",
  "GraduationYear",
  "PhotoId",
  "RecordTypeValueId",
  "RecordStatusValueId",
  "IsDeceased",
] as const;

export const PRESENCE_FIELDS = ["Id", "RecordTypeValueId", "RecordStatusValueId", "IsDeceased"] as const;

export const PHONE_FIELDS = ["PersonId", "Number", "CountryCode", "IsUnlisted", "NumberTypeValueId"] as const;

export const IDS_PER_REQUEST = 50;
const PAGE = 500;
// Changes read per run, per kind; a church with more waits for the next run.
const MAX_CHANGE_PAGES = 20;
const MAX_PHOTO_BYTES = 524_288;

// Rock's ModifiedDateTime, in the church's own time zone. Checked before it
// goes into a filter, since the mark is stored and read back.
const ROCK_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,7})?$/;
/** The stored mark: a Rock time, then the last People and PhoneNumbers row ids read at that time, if a scan stopped there. */
const CURSOR = /^([^;]+)(?:;p=(\d{1,12}))?(?:;n=(\d{1,12}))?$/;
const ROCK_ID = /^[1-9][0-9]{0,9}$/;

export const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
export const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);
export const rows = (body: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(body)) throw new RecordsError("not_provider");
  return body.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
};

export interface CopyIds {
  recordTypePerson: number;
  recordStatusInactive: number | null;
  mobile: number | null;
  work: number | null;
}

async function copyIds(creds: RecordsCredentials, fetcher: FetchLike): Promise<CopyIds> {
  const guids = [ROCK_GUIDS.recordTypePerson, ROCK_GUIDS.recordStatusInactive, ...Object.values(ROCK_PHONE_TYPE_GUIDS)];
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
    mobile: byGuid.get(ROCK_PHONE_TYPE_GUIDS.mobile) ?? null,
    work: byGuid.get(ROCK_PHONE_TYPE_GUIDS.work) ?? null,
  };
}

export function presenceOf(row: Record<string, unknown>, ids: Pick<CopyIds, "recordTypePerson" | "recordStatusInactive">): RecordsPresence {
  if (row.IsDeceased === true) return "inactive";
  if (int(row.RecordTypeValueId) !== ids.recordTypePerson) return "inactive";
  if (ids.recordStatusInactive !== null && int(row.RecordStatusValueId) === ids.recordStatusInactive) return "inactive";
  return "active";
}

export function rockIds(ids: readonly string[]): number[] {
  return [...new Set(ids.filter((id) => ROCK_ID.test(id)))].map(Number);
}

export async function byIdChunks(
  creds: RecordsCredentials,
  path: string,
  column: string,
  ids: readonly number[],
  select: readonly string[],
  fetcher: FetchLike,
  extra: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + IDS_PER_REQUEST);
    const filter = chunk.map((id) => `${column} eq ${id}`).join(" or ");
    // A person has a handful of phones at most, so one page of phones is bounded by the chunk.
    const top = path === "/api/PhoneNumbers" ? chunk.length * 10 : chunk.length;
    found.push(
      ...rows(
        await getJson(creds, path, { ...extra, $filter: filter, $select: select.join(","), $top: String(top) }, fetcher),
      ),
    );
  }
  return found;
}

function definedValueText(values: Map<number, string>, id: unknown): string | null {
  const key = int(id);
  return key === null ? null : values.get(key) || null;
}

/** Rock stores the anniversary as a date and time; only the date is used. */
export function parseRockDate(value: unknown): RecordsDate {
  const match = typeof value === "string" ? /^(\d{4})-(\d\d)-(\d\d)/.exec(value) : null;
  if (!match) return { month: null, day: null, year: null };
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Listed phones only: an unlisted number is dropped here and never reaches two42. */
export function parsePhones(phoneRows: readonly Record<string, unknown>[], ids: Pick<CopyIds, "mobile" | "work">) {
  const byPerson = new Map<number, { mobile: RecordsPhone | null; work: RecordsPhone | null }>();
  for (const row of phoneRows) {
    const personId = int(row.PersonId);
    const number = text(row.Number).replace(/\D/g, "");
    if (!personId || !number || row.IsUnlisted !== false) continue;
    const type = int(row.NumberTypeValueId);
    const kind = type !== null && type === ids.mobile ? "mobile" : type !== null && type === ids.work ? "work" : null;
    if (!kind) continue;
    const entry = byPerson.get(personId) ?? { mobile: null, work: null };
    entry[kind] ??= { countryCode: text(row.CountryCode).replace(/\D/g, ""), number };
    byPerson.set(personId, entry);
  }
  return byPerson;
}

function parseGender(value: unknown): "male" | "female" | null {
  return value === 1 ? "male" : value === 2 ? "female" : null;
}

async function peopleForCopy(
  creds: RecordsCredentials,
  ids: readonly string[],
  fetcher: FetchLike,
): Promise<RecordsCopyPerson[]> {
  const numeric = rockIds(ids);
  if (numeric.length === 0) return [];
  const valueIds = await copyIds(creds, fetcher);
  const people = (await byIdChunks(creds, "/api/People", "Id", numeric, COPY_PERSON_FIELDS, fetcher)).filter(
    (row) => numeric.includes(int(row.Id) ?? 0) && presenceOf(row, valueIds) === "active",
  );
  if (people.length === 0) return [];
  const personIds = people.map((row) => int(row.Id) as number);
  const phones = parsePhones(
    await byIdChunks(creds, "/api/PhoneNumbers", "PersonId", personIds, PHONE_FIELDS, fetcher),
    valueIds,
  );
  const affixIds = [
    ...new Set(people.flatMap((row) => [int(row.TitleValueId), int(row.SuffixValueId)]).filter((id) => id !== null)),
  ] as number[];
  const affixes = new Map<number, string>();
  for (const row of affixIds.length
    ? await byIdChunks(creds, "/api/DefinedValues", "Id", affixIds, ["Id", "Value"], fetcher)
    : []) {
    const id = int(row.Id);
    if (id) affixes.set(id, text(row.Value));
  }
  return people.map((row) => {
    const id = int(row.Id) as number;
    const phone = phones.get(id);
    const photo = int(row.PhotoId);
    return {
      id: String(id),
      firstName: text(row.FirstName),
      lastName: text(row.LastName),
      nickName: text(row.NickName),
      title: definedValueText(affixes, row.TitleValueId),
      suffix: definedValueText(affixes, row.SuffixValueId),
      gender: parseGender(row.Gender),
      mobile: phone?.mobile ?? null,
      work: phone?.work ?? null,
      birthday: { month: int(row.BirthMonth), day: int(row.BirthDay), year: int(row.BirthYear) },
      anniversary: parseRockDate(row.AnniversaryDate),
      graduationYear: int(row.GraduationYear),
      photo: photo === null ? null : String(photo),
    };
  });
}

async function presence(
  creds: RecordsCredentials,
  ids: readonly string[],
  fetcher: FetchLike,
): Promise<Map<string, RecordsPresence>> {
  const numeric = rockIds(ids);
  const found = new Map<string, RecordsPresence>();
  if (numeric.length === 0) return found;
  const valueIds = await copyIds(creds, fetcher);
  for (const row of await byIdChunks(creds, "/api/People", "Id", numeric, PRESENCE_FIELDS, fetcher)) {
    const id = int(row.Id);
    if (id && numeric.includes(id)) found.set(String(id), presenceOf(row, valueIds));
  }
  return found;
}

/**
 * The ids changed since `since`, oldest first, and the latest time read. Pages
 * follow the last row read rather than an offset: a row edited mid-scan moves
 * to the end, and an offset would then skip the row after it.
 */
async function changedRows(
  creds: RecordsCredentials,
  path: string,
  idColumn: string,
  since: string,
  afterId: number | null,
  fetcher: FetchLike,
): Promise<{ ids: number[]; latest: string | null; cut: boolean; lastId: number | null }> {
  const ids: number[] = [];
  let latest: string | null = null;
  let after: { time: string; id: number } | null = afterId ? { time: since, id: afterId } : null;
  const select = [...new Set([idColumn, "Id", "ModifiedDateTime"])].join(",");
  for (let page = 0; page < MAX_CHANGE_PAGES; page++) {
    const filter: string = after
      ? `ModifiedDateTime gt datetime'${after.time}' or (ModifiedDateTime eq datetime'${after.time}' and Id gt ${after.id})`
      : `ModifiedDateTime ge datetime'${since}'`;
    const body = rows(
      await getJson(
        creds,
        path,
        { $filter: filter, $select: select, $orderby: "ModifiedDateTime,Id", $top: String(PAGE) },
        fetcher,
      ),
    );
    for (const row of body) {
      const id = int(row[idColumn]);
      if (id) ids.push(id);
      if (typeof row.ModifiedDateTime === "string" && ROCK_TIME.test(row.ModifiedDateTime)) latest = row.ModifiedDateTime;
    }
    if (body.length < PAGE) return { ids, latest, cut: false, lastId: null };
    const last = body[body.length - 1];
    const lastId = int(last.Id);
    // Without the last row's place the next page can't be asked for safely.
    if (typeof last.ModifiedDateTime !== "string" || !ROCK_TIME.test(last.ModifiedDateTime) || !lastId) {
      return { ids, latest, cut: true, lastId: null };
    }
    after = { time: last.ModifiedDateTime, id: lastId };
  }
  return { ids, latest, cut: true, lastId: after?.time === latest ? after.id : null };
}

async function latestChange(creds: RecordsCredentials, path: string, fetcher: FetchLike): Promise<string | null> {
  const [row] = rows(
    await getJson(
      creds,
      path,
      { $select: "ModifiedDateTime", $orderby: "ModifiedDateTime desc", $top: "1" },
      fetcher,
    ),
  );
  const value = row?.ModifiedDateTime;
  return typeof value === "string" && ROCK_TIME.test(value) ? value : null;
}

const earliest = (a: string, b: string) => (a < b ? a : b);
const latestOf = (values: (string | null)[]) =>
  values.filter((v): v is string => v !== null).reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

// A phone added or changed in Rock changes its PhoneNumber row, not the
// person, so both are read. The mark is inclusive ("ge"), so the people at the
// mark itself are read again next time rather than missed.
async function changedSince(
  creds: RecordsCredentials,
  cursor: string | null,
  fetcher: FetchLike,
): Promise<RecordsChanges> {
  // Taken before either scan: a phone saved after the people were read must not
  // carry the mark past a person saved in between.
  const mark = latestOf([
    await latestChange(creds, "/api/People", fetcher),
    await latestChange(creds, "/api/PhoneNumbers", fetcher),
  ]);
  const stored = cursor === null ? null : CURSOR.exec(cursor);
  if (!stored || !ROCK_TIME.test(stored[1])) {
    // A Rock with no people yet: start from the beginning.
    return { ids: [], cursor: mark ?? "1900-01-01T00:00:00" };
  }
  const since = stored[1];
  const people = await changedRows(creds, "/api/People", "Id", since, stored[2] ? Number(stored[2]) : null, fetcher);
  const phones = await changedRows(creds, "/api/PhoneNumbers", "PersonId", since, stored[3] ? Number(stored[3]) : null, fetcher);
  let next = latestOf([since, mark]) as string;
  // A kind cut short is read on from where it stopped; the other kind repeats a little.
  if (people.cut && people.latest) next = earliest(next, people.latest);
  if (phones.cut && phones.latest) next = earliest(next, phones.latest);
  // A kind cut short at the mark itself also keeps its last row's id, or a run
  // of more rows than one scan reads, all saved at one time, would be read again forever.
  const p = people.cut && people.latest === next && people.lastId ? `;p=${people.lastId}` : "";
  const n = phones.cut && phones.latest === next && phones.lastId ? `;n=${phones.lastId}` : "";
  return { ids: [...new Set([...people.ids, ...phones.ids])].map(String), cursor: `${next}${p}${n}` };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

// Rock serves photos only through GetImage.ashx, which checks Rock's own photo
// security and never reads the REST key, so the key isn't sent with it.
async function photo(
  creds: RecordsCredentials,
  token: string,
  maxEdge: number,
  fetcher: FetchLike,
): Promise<Uint8Array | null> {
  if (!ROCK_ID.test(token)) return null;
  const url = new URL("/GetImage.ashx", creds.baseUrl);
  url.searchParams.set("id", token);
  url.searchParams.set("maxwidth", String(maxEdge));
  url.searchParams.set("maxheight", String(maxEdge));
  url.searchParams.set("format", "jpg");
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "image/jpeg" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RecordsError("unreachable");
  }
  if (response.status >= 500 || response.status === 429) {
    await response.body?.cancel();
    throw new RecordsError("unreachable", response.status);
  }
  if (response.status !== 200 || !(response.headers.get("content-type") ?? "").startsWith("image/jpeg")) {
    await response.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length <= MAX_PHOTO_BYTES && isJpeg(bytes) ? bytes : null;
}

export function rockCopySource(fetcher: FetchLike = safeFetch): RecordsCopySource {
  return {
    changedSince: (creds, cursor) => changedSince(creds, cursor, fetcher),
    peopleForCopy: (creds, ids) => peopleForCopy(creds, ids, fetcher),
    presence: (creds, ids) => presence(creds, ids, fetcher),
    photo: (creds, token, maxEdge) => photo(creds, token, maxEdge, fetcher),
  };
}
