import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { ROCK_GUIDS, ROCK_REST_PATHS } from "../_shared/rock-client.ts";
import { ROCK_FAMILY_GUIDS, rockHouseholdSource } from "../_shared/rock-households.ts";

const creds = { baseUrl: "https://rock.example.org", key: "secret-key-123" };

const DEFINED_VALUES = [
  { Id: 1, Guid: ROCK_GUIDS.recordTypePerson },
  { Id: 4, Guid: ROCK_GUIDS.recordStatusInactive },
  { Id: 20, Guid: ROCK_FAMILY_GUIDS.married.toUpperCase() },
  { Id: 30, Guid: ROCK_FAMILY_GUIDS.homeLocation },
  { Id: 40, Guid: ROCK_FAMILY_GUIDS.homePhone },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function rock(routes: Record<string, (url: URL) => Response>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetcher = (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url.pathname];
    return Promise.resolve(route ? route(url) : new Response("missing", { status: 404 }));
  };
  return { calls, source: rockHouseholdSource(fetcher) };
}

const person = (Id: number, over: Record<string, unknown> = {}) => ({
  Id,
  AgeClassification: 1,
  MaritalStatusValueId: 20,
  RecordTypeValueId: 1,
  RecordStatusValueId: 3,
  IsDeceased: false,
  FirstName: `First${Id}`,
  LastName: "Hale",
  BirthMonth: 3,
  BirthDay: 14,
  GraduationYear: null,
  PhotoId: null,
  ...over,
});

const FAMILY_ROUTES = {
  "/api/DefinedValues": () => json(DEFINED_VALUES),
  "/api/Groups": () =>
    json([{
      Id: 500,
      GroupLocations: [
        { LocationId: 700, GroupLocationTypeValueId: 30, IsMailingLocation: false },
        { LocationId: 701, GroupLocationTypeValueId: 30, IsMailingLocation: true },
        { LocationId: 702, GroupLocationTypeValueId: 99, IsMailingLocation: true },
      ],
    }]),
  "/api/GroupMembers": () =>
    json([
      { GroupId: 500, PersonId: 100, GroupMemberStatus: 1 },
      { GroupId: 500, PersonId: 101, GroupMemberStatus: "Active" },
      { GroupId: 500, PersonId: 102, GroupMemberStatus: 1 },
      { GroupId: 500, PersonId: 103, GroupMemberStatus: 2 },
      { GroupId: 500, PersonId: 104, GroupMemberStatus: 1 },
    ]),
  "/api/People": () =>
    json([
      person(100),
      person(101),
      person(102, { AgeClassification: 2, MaritalStatusValueId: null, FirstName: "lily", BirthMonth: 2, BirthDay: 30, GraduationYear: 2034, PhotoId: 88 }),
      person(103),
      person(104, { IsDeceased: true }),
    ]),
  "/api/Locations": () =>
    json([{ Id: 701, Street1: "12 Oak St", Street2: "", City: "Austin", State: "TX", PostalCode: "78701", Country: "US" }]),
  "/api/PhoneNumbers": () =>
    json([
      { PersonId: 100, Number: "5125550100", CountryCode: "1", IsUnlisted: true, NumberTypeValueId: 40 },
      { PersonId: 100, Number: "5125550111", CountryCode: "1", IsUnlisted: false, NumberTypeValueId: 12 },
      { PersonId: 101, Number: "(512) 555-0122", CountryCode: "1", IsUnlisted: false, NumberTypeValueId: 40 },
    ]),
};

Deno.test("familyOf reads each person's own family and nothing else about them", async () => {
  const { calls, source } = rock({
    "/api/People": () => json([{ Id: 100, PrimaryFamilyId: 500 }, { Id: 101, PrimaryFamilyId: null }, { Id: 999, PrimaryFamilyId: 1 }]),
  });
  const found = await source.familyOf(creds, ["100", "101", "1 or 1 eq 1"]);
  assertEquals([...found], [["100", "500"]]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url.searchParams.get("$select"), "Id,PrimaryFamilyId");
  assertEquals(calls[0].url.searchParams.get("$filter"), "Id eq 100 or Id eq 101");
});

Deno.test("families come back with their active members, home address and listed home phone", async () => {
  const { source } = rock(FAMILY_ROUTES);
  const [family] = await source.families(creds, ["500"], { children: true });
  assertEquals(family.id, "500");
  // 103 is pending in the family and 104 has died.
  assertEquals(family.members, [
    { id: "100", adult: true, married: true },
    { id: "101", adult: true, married: true },
    { id: "102", adult: false, married: false },
  ]);
  // The home location marked for mail, not the first one listed.
  assertEquals(family.address, { street1: "12 Oak St", street2: "", city: "Austin", state: "TX", postalCode: "78701", country: "US" });
  // 100's home number is unlisted, so the family's is 101's.
  assertEquals(family.homePhone, { countryCode: "1", number: "5125550122" });
  // The month and day pass on as the records hold them; the planner decides whether they make a date.
  assertEquals(family.children, [{
    id: "102",
    firstName: "lily",
    lastName: "Hale",
    birthday: { month: 2, day: 30 },
    graduationYear: 2034,
    photo: "88",
  }]);
});

Deno.test("every request only reads, through the listed controllers, and never asks for a birth year", async () => {
  const { calls, source } = rock(FAMILY_ROUTES);
  await source.families(creds, ["500"], { children: true });
  await source.familyOf(creds, ["100"]);
  const paths = new Set(calls.map((c) => c.url.pathname));
  for (const path of paths) assert((ROCK_REST_PATHS as readonly string[]).includes(path), path);
  assertEquals([...paths].sort(), [
    "/api/DefinedValues",
    "/api/GroupMembers",
    "/api/Groups",
    "/api/Locations",
    "/api/People",
    "/api/PhoneNumbers",
  ]);
  for (const { url, init } of calls) {
    assertEquals(init.method, "GET");
    assertEquals(init.redirect, "error");
    assertFalse((url.searchParams.get("$select") ?? "").includes("BirthYear"));
    assertFalse((url.searchParams.get("$select") ?? "").includes("Email"));
    assert(url.searchParams.get("$select"), `${url.pathname} names what it reads`);
  }
  const groups = calls.find((c) => c.url.pathname === "/api/Groups")!.url;
  assertEquals(groups.searchParams.get("$expand"), "GroupLocations");
  const members = calls.find((c) => c.url.pathname === "/api/GroupMembers")!.url;
  assertEquals(members.searchParams.get("$filter"), "(GroupId eq 500) and IsArchived eq false");
  assertEquals(members.searchParams.get("$select"), "GroupId,PersonId,GroupMemberStatus");
});

Deno.test("with children off, no child's name, birthday, grade or photo is asked for", async () => {
  const { calls, source } = rock(FAMILY_ROUTES);
  const [family] = await source.families(creds, ["500"], { children: false });
  assertEquals(family.children, []);
  const people = calls.find((c) => c.url.pathname === "/api/People")!.url.searchParams.get("$select")!;
  assertEquals(people, "Id,AgeClassification,MaritalStatusValueId,RecordTypeValueId,RecordStatusValueId,IsDeceased");
});

Deno.test("a family the records don't have is left out, and nothing more is read for it", async () => {
  const { calls, source } = rock({ "/api/DefinedValues": () => json(DEFINED_VALUES), "/api/Groups": () => json([]) });
  assertEquals(await source.families(creds, ["500", "not-an-id"], { children: true }), []);
  assertEquals(calls.map((c) => c.url.pathname), ["/api/DefinedValues", "/api/Groups"]);
});

Deno.test("a family's address outside its home locations isn't used", async () => {
  const { source } = rock({
    ...FAMILY_ROUTES,
    "/api/Groups": () => json([{ Id: 500, GroupLocations: [{ LocationId: 702, GroupLocationTypeValueId: 99 }] }]),
    "/api/Locations": () =>
      json([{ Id: 702, Street1: "1 Work Plaza", Street2: "", City: "Austin", State: "TX", PostalCode: "78701", Country: "US" }]),
  });
  const [family] = await source.families(creds, ["500"], { children: false });
  assertEquals(family.address, null);
});

Deno.test("members are read a page at a time", async () => {
  const pages: string[] = [];
  const { source } = rock({
    ...FAMILY_ROUTES,
    "/api/GroupMembers": (url) => {
      pages.push(url.searchParams.get("$skip")!);
      return json(
        url.searchParams.get("$skip") === "0"
          ? Array.from({ length: 500 }, (_, i) => ({ GroupId: 500, PersonId: 1000 + i, GroupMemberStatus: 1 }))
          : [],
      );
    },
  });
  await source.families(creds, ["500"], { children: false });
  assertEquals(pages, ["0", "500"]);
});
