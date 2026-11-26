import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import { RecordsError } from "../_shared/records-errors.ts";
import { rockCopySource, ROCK_PHONE_TYPE_GUIDS } from "../_shared/rock-copy.ts";
import { ROCK_GUIDS } from "../_shared/rock-client.ts";

const creds = { baseUrl: "https://rock.example.org", key: "secret-key-123" };

const DEFINED_VALUES = [
  { Id: 1, Guid: ROCK_GUIDS.recordTypePerson.toUpperCase() },
  { Id: 4, Guid: ROCK_GUIDS.recordStatusInactive },
  { Id: 12, Guid: ROCK_PHONE_TYPE_GUIDS.mobile },
  { Id: 13, Guid: ROCK_PHONE_TYPE_GUIDS.work },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A fake Rock answering by path, recording every request. */
function rock(routes: Record<string, (url: URL) => Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher = (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    const filter = url.searchParams.get("$filter") ?? "";
    const key = url.pathname === "/api/DefinedValues" && filter.startsWith("Id eq") ? "affixes" : url.pathname;
    const route = routes[key];
    return Promise.resolve(route ? route(url) : new Response("missing", { status: 404 }));
  };
  return { calls, source: rockCopySource(fetcher) };
}

const PERSON = {
  Id: 100,
  FirstName: "Margaret",
  NickName: "Peggy",
  LastName: "Hale",
  TitleValueId: 50,
  SuffixValueId: null,
  Gender: 2,
  BirthMonth: 3,
  BirthDay: 14,
  BirthYear: 1961,
  AnniversaryDate: "1985-06-01T00:00:00",
  GraduationYear: null,
  PhotoId: 77,
  RecordTypeValueId: 1,
  RecordStatusValueId: 3,
  IsDeceased: false,
};

Deno.test("peopleForCopy reads only the fields two42 copies, and never an unlisted phone", async () => {
  const { calls, source } = rock({
    "/api/DefinedValues": () => json(DEFINED_VALUES),
    affixes: () => json([{ Id: 50, Value: "Dr." }]),
    "/api/People": () => json([PERSON]),
    "/api/PhoneNumbers": () =>
      json([
        { PersonId: 100, Number: "(512) 555-0123", CountryCode: "1", IsUnlisted: true, NumberTypeValueId: 12 },
        { PersonId: 100, Number: "5125550188", CountryCode: "1", IsUnlisted: false, NumberTypeValueId: 13 },
      ]),
  });
  const [person] = await source.peopleForCopy(creds, ["100", "1 or 1 eq 1"]);
  assertEquals(person, {
    id: "100",
    firstName: "Margaret",
    lastName: "Hale",
    nickName: "Peggy",
    title: "Dr.",
    suffix: null,
    gender: "female",
    mobile: null,
    work: { countryCode: "1", number: "5125550188" },
    birthday: { month: 3, day: 14, year: 1961 },
    anniversary: { month: 6, day: 1, year: 1985 },
    graduationYear: null,
    photo: "77",
  });

  for (const { url, init } of calls) {
    assertEquals(init.method, "GET");
    assertEquals((init.headers as Record<string, string>)["Authorization-Token"], "secret-key-123");
    const select = url.searchParams.get("$select") ?? "";
    for (const never of ["Email", "IsMessagingEnabled", "ConnectionStatusValueId", "Attribute"]) {
      assertFalse(select.includes(never), `${url.pathname} selects ${never}`);
    }
  }
  const people = calls.find((c) => c.url.pathname === "/api/People")!.url;
  assertEquals(people.searchParams.get("$filter"), "Id eq 100");
  assertEquals(
    calls.find((c) => c.url.pathname === "/api/PhoneNumbers")!.url.searchParams.get("$select"),
    "PersonId,Number,CountryCode,IsUnlisted,NumberTypeValueId",
  );
});

Deno.test("an inactive person is not copied", async () => {
  const { source } = rock({
    "/api/DefinedValues": () => json(DEFINED_VALUES),
    "/api/People": () => json([{ ...PERSON, RecordStatusValueId: 4 }]),
  });
  assertEquals(await source.peopleForCopy(creds, ["100"]), []);
});

Deno.test("presence tells active, inactive and gone apart", async () => {
  const { calls, source } = rock({
    "/api/DefinedValues": () => json(DEFINED_VALUES),
    "/api/People": () =>
      json([
        { Id: 100, RecordTypeValueId: 1, RecordStatusValueId: 3, IsDeceased: false },
        { Id: 101, RecordTypeValueId: 1, RecordStatusValueId: 4, IsDeceased: false },
        { Id: 102, RecordTypeValueId: 1, RecordStatusValueId: 3, IsDeceased: true },
      ]),
  });
  const found = await source.presence(creds, ["100", "101", "102", "103"]);
  assertEquals([...found.entries()], [["100", "active"], ["101", "inactive"], ["102", "inactive"]]);
  assertEquals(
    calls.find((c) => c.url.pathname === "/api/People")!.url.searchParams.get("$select"),
    "Id,RecordTypeValueId,RecordStatusValueId,IsDeceased",
  );
});

Deno.test("with no mark yet, changedSince reads nobody and returns the latest change as the mark", async () => {
  const { calls, source } = rock({
    "/api/People": () => json([{ ModifiedDateTime: "2026-11-20T10:00:00.123" }]),
    "/api/PhoneNumbers": () => json([{ ModifiedDateTime: "2026-11-21T08:00:00" }]),
  });
  assertEquals(await source.changedSince(creds, null), { ids: [], cursor: "2026-11-21T08:00:00" });
  assert(calls.every((c) => c.url.searchParams.get("$top") === "1"));
});

Deno.test("changedSince asks only for people and phones changed since the mark", async () => {
  const { calls, source } = rock({
    "/api/People": () => json([{ Id: 100, ModifiedDateTime: "2026-11-22T09:00:00" }]),
    "/api/PhoneNumbers": () => json([{ PersonId: 101, ModifiedDateTime: "2026-11-23T09:00:00" }]),
  });
  assertEquals(await source.changedSince(creds, "2026-11-21T08:00:00"), {
    ids: ["100", "101"],
    cursor: "2026-11-23T09:00:00",
  });
  for (const { url } of calls.filter((c) => c.url.searchParams.get("$top") !== "1")) {
    assertEquals(url.searchParams.get("$filter"), "ModifiedDateTime ge datetime'2026-11-21T08:00:00'");
  }
});

Deno.test("a phone saved after the people were read doesn't carry the mark past a person saved in between", async () => {
  const { source } = rock({
    "/api/People": (url) =>
      json(url.searchParams.get("$top") === "1" ? [{ ModifiedDateTime: "2026-11-22T10:00:00" }] : []),
    // Rock's newest phone row at the start was 09:00; the scan then sees one saved at 10:02.
    "/api/PhoneNumbers": (url) =>
      json(
        url.searchParams.get("$top") === "1"
          ? [{ ModifiedDateTime: "2026-11-22T09:00:00" }]
          : [{ PersonId: 101, ModifiedDateTime: "2026-11-22T10:02:00" }],
      ),
  });
  assertEquals(await source.changedSince(creds, "2026-11-21T08:00:00"), {
    ids: ["101"],
    cursor: "2026-11-22T10:00:00",
  });
});

Deno.test("changedSince asks for each next page after the last row read, not by offset", async () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ Id: i + 1, ModifiedDateTime: "2026-11-22T09:00:00.5" }));
  const { calls, source } = rock({
    "/api/People": (url) => json(url.searchParams.get("$filter")?.includes("Id gt") ? [{ Id: 900, ModifiedDateTime: "2026-11-22T10:00:00" }] : page),
    "/api/PhoneNumbers": () => json([]),
  });
  const { ids } = await source.changedSince(creds, "2026-11-21T08:00:00");
  assertEquals(ids.length, 501);
  const people = calls
    .filter((c) => c.url.pathname === "/api/People" && c.url.searchParams.get("$top") !== "1")
    .map((c) => c.url.searchParams);
  assertEquals(
    people[1].get("$filter"),
    "ModifiedDateTime gt datetime'2026-11-22T09:00:00.5' or (ModifiedDateTime eq datetime'2026-11-22T09:00:00.5' and Id gt 500)",
  );
  assert(people.every((params) => params.get("$skip") === null && params.get("$orderby") === "ModifiedDateTime,Id"));
});

Deno.test("a stored mark that isn't a Rock time never reaches a filter", async () => {
  const { calls, source } = rock({ "/api/People": () => json([]), "/api/PhoneNumbers": () => json([]) });
  await source.changedSince(creds, "2026-11-21T08:00:00' or Id gt 0 or '");
  assert(calls.every((c) => !(c.url.searchParams.get("$filter") ?? "").includes("Id gt 0")));
});

Deno.test("a photo comes from Rock's image handler without the key, and only as a small JPEG", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const image = (body: Uint8Array<ArrayBuffer>, type = "image/jpeg", status = 200) => () =>
    new Response(body, { status, headers: { "content-type": type } });

  const ok = rock({ "/GetImage.ashx": image(jpeg) });
  assertEquals(await ok.source.photo(creds, "77", 400), jpeg);
  const { url, init } = ok.calls[0];
  assertEquals(url.search, "?id=77&maxwidth=400&maxheight=400&format=jpg");
  assertFalse("Authorization-Token" in (init.headers as Record<string, string>));

  assertEquals(await rock({ "/GetImage.ashx": image(jpeg, "image/png") }).source.photo(creds, "77", 400), null);
  assertEquals(await rock({ "/GetImage.ashx": image(new Uint8Array([1, 2, 3, 4])) }).source.photo(creds, "77", 400), null);
  assertEquals(
    await rock({ "/GetImage.ashx": image(new Uint8Array(600_000).fill(0xff)) }).source.photo(creds, "77", 400),
    null,
  );
  assertEquals(await rock({ "/GetImage.ashx": image(jpeg, "image/jpeg", 404) }).source.photo(creds, "77", 400), null);
  for (const status of [500, 503, 429]) {
    await assertRejects(
      () => rock({ "/GetImage.ashx": image(jpeg, "image/jpeg", status) }).source.photo(creds, "77", 400),
      RecordsError,
    );
  }
  const down = rockCopySource(() => Promise.reject(new TypeError("network")));
  await assertRejects(() => down.photo(creds, "77", 400), RecordsError);
  const refused = rock({ "/GetImage.ashx": image(jpeg) });
  assertEquals(await refused.source.photo(creds, "../x", 400), null);
  assertEquals(refused.calls, []);
});
