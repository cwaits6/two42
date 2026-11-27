import { assertEquals } from "jsr:@std/assert@1";
import {
  childSuggestionRows,
  householdChurchValues,
  type HouseholdStoredValue,
  type PlanProfile,
  planHouseholdCopy,
  planHouseholdSuggestions,
  type SuggestionInput,
} from "../_shared/records-households.ts";
import type { RecordsFamily } from "../_shared/records-types.ts";
import { normalizePhone } from "../_shared/phone.ts";

const H1 = "00000000-0000-0000-0000-00000000f001";
const H2 = "00000000-0000-0000-0000-00000000f002";
const H3 = "00000000-0000-0000-0000-00000000f003";

const profile = (id: string, over: Partial<PlanProfile> = {}): PlanProfile => ({
  id,
  family_id: null,
  relationship: "primary",
  role: "member",
  first_name: id,
  last_name: "Smith",
  ...over,
});

const family = (id: string, members: RecordsFamily["members"]): RecordsFamily => ({
  id,
  members,
  children: [],
  address: null,
  homePhone: null,
});

function input(over: Partial<SuggestionInput> & { people: PlanProfile[] }): SuggestionInput {
  const families = over.families ?? [];
  const familyOf = new Map<string, string>();
  for (const f of families) for (const m of f.members) familyOf.set(m.id, f.id);
  return {
    families,
    familyOf: over.familyOf ?? familyOf,
    links: over.links ?? new Map(over.people.map((p) => [`r-${p.id}`, p.id])),
    profiles: new Map(over.people.map((p) => [p.id, p])),
    households: over.households ?? new Map([
      [H1, { id: H1, created_at: "2026-01-01" }],
      [H2, { id: H2, created_at: "2026-02-01" }],
      [H3, { id: H3, created_at: "2026-03-01" }],
    ]),
    householdLinks: over.householdLinks ?? new Map(),
  };
}

const adult = (id: string, married = false) => ({ id: `r-${id}`, adult: true, married });

Deno.test("two linked people of one family in different households are one suggestion to check first", () => {
  const ted = profile("ted", { family_id: H1, first_name: "Ted" });
  const cindy = profile("cindy", { family_id: H2, first_name: "Cindy" });
  const kid = profile("kid", { family_id: H1, relationship: "other", first_name: "Amy" });
  const [s, ...rest] = planHouseholdSuggestions(input({
    people: [ted, cindy, kid],
    families: [family("F", [adult("ted", true), adult("cindy", true), { id: "r-kid", adult: false, married: false }])],
  }));
  assertEquals(rest, []);
  // H1 holds two of them, so it is theirs; Ted, already its primary there, stays primary.
  assertEquals(s, {
    external_family_id: "F",
    target_family_id: H1,
    family_name: null,
    people: [
      { profile_id: "kid", from_family_id: H1, from_relationship: "other", relationship: "child" },
      { profile_id: "cindy", from_family_id: H2, from_relationship: "primary", relationship: "spouse" },
    ],
    basis: [
      { profile_id: "cindy", external_person_id: "r-cindy", family_id: H2 },
      { profile_id: "kid", external_person_id: "r-kid", family_id: H1 },
      { profile_id: "ted", external_person_id: "r-ted", family_id: H1 },
    ],
    ready: false,
  });
});

Deno.test("people in no household are suggested a new one, named from two42's own last name, ready to confirm", () => {
  const a = profile("a", { first_name: "Ann", last_name: "jones" });
  const b = profile("b", { first_name: "Bob", last_name: "Jones" });
  const [s] = planHouseholdSuggestions(input({ people: [a, b], families: [family("F", [adult("a"), adult("b")])] }));
  assertEquals(s.target_family_id, null);
  assertEquals(s.family_name, "Jones");
  assertEquals(s.ready, true);
  // Not both married in the records: the first by name is primary, the other keeps no duplicate place.
  assertEquals(s.people.map((p) => [p.profile_id, p.relationship]), [["a", "primary"], ["b", "other"]]);
});

Deno.test("a family already sharing an unlinked household is a link-only suggestion", () => {
  const a = profile("a", { family_id: H1 });
  const b = profile("b", { family_id: H1, relationship: "spouse" });
  const [s] = planHouseholdSuggestions(input({ people: [a, b], families: [family("F", [adult("a", true), adult("b", true)])] }));
  assertEquals(s, {
    external_family_id: "F",
    target_family_id: H1,
    family_name: null,
    people: [],
    basis: [
      { profile_id: "a", external_person_id: "r-a", family_id: H1 },
      { profile_id: "b", external_person_id: "r-b", family_id: H1 },
    ],
    ready: true,
  });
});

Deno.test("a household already linked to its family, with nothing to change, isn't suggested", () => {
  const a = profile("a", { family_id: H1 });
  const b = profile("b", { family_id: H1, relationship: "spouse" });
  assertEquals(
    planHouseholdSuggestions(input({
      people: [a, b],
      families: [family("F", [adult("a", true), adult("b", true)])],
      householdLinks: new Map([[H1, "F"]]),
    })),
    [],
  );
});

Deno.test("a household linked to another family is never chosen", () => {
  const a = profile("a", { family_id: H1 });
  const b = profile("b");
  const [s] = planHouseholdSuggestions(input({
    people: [a, b],
    families: [family("F", [adult("a"), adult("b")])],
    householdLinks: new Map([[H1, "OTHER"]]),
  }));
  assertEquals(s.target_family_id, null);
  assertEquals(s.ready, false);
});

Deno.test("a couple isn't made spouses when the household keeps another primary", () => {
  const stay = profile("stay", { family_id: H1, first_name: "Al" });
  const a = profile("a", { family_id: H1, relationship: "other" });
  const b = profile("b", { family_id: H2 });
  const [s] = planHouseholdSuggestions(input({
    people: [stay, a, b],
    links: new Map([["r-a", "a"], ["r-b", "b"]]),
    families: [family("F", [adult("a", true), adult("b", true)])],
  }));
  assertEquals(s.target_family_id, H1);
  // b was primary in H2; H1 keeps its own primary, so b comes in as other.
  assertEquals(s.people, [{ profile_id: "b", from_family_id: H2, from_relationship: "primary", relationship: "other" }]);
});

Deno.test("one household isn't the target of two families in one pass", () => {
  const a = profile("a", { family_id: H1 });
  const b = profile("b", { family_id: H1 });
  const c = profile("c", { family_id: H1 });
  const suggestions = planHouseholdSuggestions(input({
    people: [a, b, c],
    families: [family("F1", [adult("a"), adult("b")]), family("F2", [adult("c")])],
  }));
  assertEquals(suggestions.map((s) => [s.external_family_id, s.target_family_id]), [["F1", H1], ["F2", null]]);
});

Deno.test("someone counts only in their own family, and pending people aren't suggested", () => {
  const a = profile("a");
  const p = profile("p", { role: "pending" });
  const [s] = planHouseholdSuggestions(input({
    people: [a, p],
    families: [family("F", [adult("a"), adult("p")])],
    familyOf: new Map([["r-a", "F"], ["r-p", "F"]]),
  }));
  assertEquals(s.people.map((x) => x.profile_id), ["a"]);
  assertEquals(
    planHouseholdSuggestions(input({ people: [a], families: [family("F", [adult("a")])], familyOf: new Map([["r-a", "G"]]) })),
    [],
  );
});

Deno.test("children carry no birth year, and a child with an account or already in the household isn't suggested", () => {
  const rows = childSuggestionRows(
    [
      { id: "1", firstName: "lily", lastName: "hale", birthday: { month: 3, day: 3 }, graduationYear: 2034, photo: "9" },
      { id: "2", firstName: "Jack", lastName: "Hale", birthday: { month: 1, day: 1 }, graduationYear: null, photo: null },
      { id: "3", firstName: "Max", lastName: "Hale", birthday: { month: 4, day: 31 }, graduationYear: 1999, photo: null },
      { id: "4", firstName: "", lastName: "Hale", birthday: { month: null, day: null }, graduationYear: null, photo: null },
      { id: "5", firstName: "Sam", lastName: "Hale", birthday: { month: null, day: null }, graduationYear: null, photo: null },
    ],
    { linked: new Set(["5"]), entries: [{ first_name: "Jack", last_name: "Hale" }] },
    "copy",
  );
  assertEquals(rows, [
    { external_person_id: "1", first_name: "Lily", last_name: "Hale", birth_month: 3, birth_day: 3, graduation_year: 2034, photo: "9" },
    { external_person_id: "3", first_name: "Max", last_name: "Hale", birth_month: null, birth_day: null, graduation_year: null, photo: null },
  ]);
});

const ADDRESS_FAMILY = {
  address: { street1: "12 oak st", street2: "", city: "austin", state: "texas", postalCode: "787011234", country: "US" },
  homePhone: { countryCode: "1", number: "5125550122" },
};
const EMPTY_HOUSEHOLD = {
  address_line1: null,
  address_line2: null,
  city: null,
  state: null,
  postal_code: null,
  phone_home: null,
  phone_profile_id: null,
};
const BOTH = new Set(["address", "phone_home"] as const);

Deno.test("the family's address and phone are normalized as the household form saves them", () => {
  assertEquals(householdChurchValues(ADDRESS_FAMILY, normalizePhone), {
    address: { address_line1: "12 Oak St", address_line2: null, city: "Austin", state: "TX", postal_code: "78701-1234" },
    phone_home: { phone_home: "+15125550122" },
  });
  const empty = { address_line1: null, address_line2: null, city: null, state: null, postal_code: null };
  for (const address of [
    { ...ADDRESS_FAMILY.address, country: "CA" },
    { ...ADDRESS_FAMILY.address, state: "Ontario" },
    { ...ADDRESS_FAMILY.address, postalCode: "1234" },
    { ...ADDRESS_FAMILY.address, street1: " " },
  ]) {
    assertEquals(householdChurchValues({ address, homePhone: null }, normalizePhone).address, empty);
  }
});

Deno.test("an empty household is filled, and the fill is recorded as the church's", () => {
  const plan = planHouseholdCopy({ fields: BOTH, current: EMPTY_HOUSEHOLD, stored: new Map(), family: ADDRESS_FAMILY, normalizePhone });
  assertEquals(plan.household, {
    address_line1: "12 Oak St",
    address_line2: null,
    city: "Austin",
    state: "TX",
    postal_code: "78701-1234",
    phone_home: "+15125550122",
  });
  assertEquals(plan.values.map((v) => [v.field, v.state]), [["address", "records"], ["phone_home", "records"]]);
});

Deno.test("an address a member entered is kept and marked as theirs; a field not from the records is left alone", () => {
  const plan = planHouseholdCopy({
    fields: new Set(["address"] as const),
    current: { ...EMPTY_HOUSEHOLD, address_line1: "9 Elm Rd" },
    stored: new Map(),
    family: ADDRESS_FAMILY,
    normalizePhone,
  });
  assertEquals(plan.household, {});
  assertEquals(plan.values.map((v) => [v.field, v.state]), [["address", "changed"]]);
});

Deno.test("a cleared address stays cleared, keeping only the church's latest value", () => {
  const stored = new Map<"address" | "phone_home", HouseholdStoredValue>([["address", { state: "cleared", churchValue: {} }]]);
  const plan = planHouseholdCopy({ fields: BOTH, current: EMPTY_HOUSEHOLD, stored, family: ADDRESS_FAMILY, normalizePhone });
  assertEquals(Object.keys(plan.household), ["phone_home"]);
  assertEquals(plan.values[0], {
    field: "address",
    state: "cleared",
    church_value: { address_line1: "12 Oak St", address_line2: null, city: "Austin", state: "TX", postal_code: "78701-1234" },
  });
});

Deno.test("a value still the church's follows the records, a removal included", () => {
  const stored = new Map<"address" | "phone_home", HouseholdStoredValue>([
    ["phone_home", { state: "records", churchValue: { phone_home: "+15125550122" } }],
  ]);
  const plan = planHouseholdCopy({
    fields: BOTH,
    current: { ...EMPTY_HOUSEHOLD, phone_home: "+15125550122" },
    stored,
    family: { ...ADDRESS_FAMILY, homePhone: null },
    normalizePhone,
  });
  assertEquals(plan.household.phone_home, null);
  assertEquals(plan.values.find((v) => v.field === "phone_home")?.state, "records");
});

Deno.test("while a spouse's own number is the household phone, the copy never writes the phone", () => {
  const plan = planHouseholdCopy({
    fields: new Set(["phone_home"] as const),
    current: { ...EMPTY_HOUSEHOLD, phone_profile_id: "spouse" },
    stored: new Map(),
    family: ADDRESS_FAMILY,
    normalizePhone,
  });
  assertEquals(plan.household, {});
  assertEquals(plan.values.map((v) => v.state), ["changed"]);
});
