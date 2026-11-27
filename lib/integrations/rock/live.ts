// Reading the details two42 shows live from a church's Rock and never stores.
// Every request is a GET with $select naming each field read; BirthYear is
// never asked for, since no screen shows a birth year.
import type { RecordsLiveDetails, RecordsLivePerson, RecordsLiveSource } from "@/lib/integrations/records/types";
import { safeFetch } from "@/lib/integrations/records/safeFetch";
import type { RecordsAddress, RecordsCredentials } from "@/supabase/functions/_shared/records-types";
import { type FetchLike, getJson } from "@/supabase/functions/_shared/rock-client";
import { byIdChunks, int, parseRockDate, rockIds, rows } from "@/supabase/functions/_shared/rock-copy";
import { GROUP_LOCATION_FIELDS, homeAddresses, ROCK_FAMILY_GUIDS } from "@/supabase/functions/_shared/rock-households";

export const LIVE_PERSON_FIELDS = ["Id", "BirthMonth", "BirthDay", "AnniversaryDate", "GraduationYear"] as const;

async function people(creds: RecordsCredentials, ids: readonly string[], fetcher: FetchLike) {
  const numeric = rockIds(ids);
  const found = new Map<string, RecordsLivePerson>();
  if (numeric.length === 0) return found;
  for (const row of await byIdChunks(creds, "/api/People", "Id", numeric, LIVE_PERSON_FIELDS, fetcher)) {
    const id = int(row.Id);
    if (!id || !numeric.includes(id)) continue;
    found.set(String(id), {
      birthday: { month: int(row.BirthMonth), day: int(row.BirthDay) },
      anniversary: parseRockDate(row.AnniversaryDate),
      graduationYear: int(row.GraduationYear),
    });
  }
  return found;
}

async function families(creds: RecordsCredentials, ids: readonly string[], fetcher: FetchLike) {
  const numeric = rockIds(ids);
  const found = new Map<string, RecordsAddress | null>();
  if (numeric.length === 0) return found;
  const body = await getJson(
    creds,
    "/api/DefinedValues",
    { $filter: `Guid eq guid'${ROCK_FAMILY_GUIDS.homeLocation}'`, $select: "Id,Guid" },
    fetcher,
  );
  const homeType = rows(body).map((row) => int(row.Id)).find((id) => id !== null) ?? null;
  const groups = (
    await byIdChunks(creds, "/api/Groups", "Id", numeric, GROUP_LOCATION_FIELDS, fetcher, { $expand: "GroupLocations" })
  ).filter((row) => numeric.includes(int(row.Id) ?? 0));
  const addresses = await homeAddresses(creds, groups, homeType, fetcher);
  for (const row of groups) {
    const id = int(row.Id) as number;
    found.set(String(id), addresses.get(id) ?? null);
  }
  return found;
}

const settled = <T>(result: PromiseSettledResult<T>) => (result.status === "fulfilled" ? result.value : null);

export function rockLiveSource(fetcher: FetchLike = safeFetch): RecordsLiveSource {
  return {
    async details(creds, request): Promise<RecordsLiveDetails> {
      // Apart, so a key that can't read families, such as one saved before households, still shows birthdays.
      const [foundPeople, foundFamilies] = await Promise.allSettled([
        people(creds, request.people, fetcher),
        families(creds, request.families, fetcher),
      ]);
      const failure = [foundPeople, foundFamilies].find((r): r is PromiseRejectedResult => r.status === "rejected");
      const readSome =
        (foundPeople.status === "fulfilled" && request.people.length > 0) ||
        (foundFamilies.status === "fulfilled" && request.families.length > 0);
      if (failure && !readSome) throw failure.reason;
      return { people: settled(foundPeople), families: settled(foundFamilies), ...(failure && { error: failure.reason }) };
    },
  };
}
