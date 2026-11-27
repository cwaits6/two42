import { describe, expect, it } from "vitest";
import { anniversaryEntries, birthdayEntries, celebrationSections } from "@/components/directory/celebrations";
import { applyLiveDetails, someUnavailable } from "@/components/directory/liveDetails";
import { calendarDate } from "@/components/directory/utils";
import { LIVE_UNAVAILABLE, liveDirectory, type LiveSources, planLiveRequest } from "@/lib/integrations/records/livePlan";
import type { RecordsLiveDetails } from "@/lib/integrations/records/types";
import type { DirectoryProfile, FamilyDirectoryFull, HouseholdFamilyMember, HouseholdMember } from "@/lib/types";
import { churchValues } from "@/supabase/functions/_shared/records-copy";
import type { RecordsCopyPerson, RecordsDate } from "@/supabase/functions/_shared/records-types";

const TODAY = calendarDate("2026-11-26");
const NONE: RecordsDate = { month: null, day: null, year: null };

// One church, as its records hold it and as two42 links it. Copy mode stores
// these values the way the refresh does; live mode reads them through the
// planner. Both must give the same lists.
const RECORDS: Record<string, { birthday: RecordsDate; anniversary: RecordsDate; graduationYear?: number }> = {
  "100": { birthday: { month: 11, day: 28, year: 1961 }, anniversary: { month: 12, day: 1, year: 1985 } },
  "101": { birthday: { month: 2, day: 30, year: 1963 }, anniversary: { month: 12, day: 1, year: 1985 } },
  "102": { birthday: { month: 11, day: 27, year: 1990 }, anniversary: NONE },
  "103": { birthday: { month: 5, day: 5, year: 1970 }, anniversary: { month: 7, day: 4, year: null } },
  "900": { birthday: { month: 11, day: 30, year: 2016 }, anniversary: NONE, graduationYear: 2034 },
};

const ANN = "ann";
const BOB = "bob";
const DAN = "dan"; // hid their birthday in two42
const EVE = "eve"; // not linked; their own birthday
const FAY = "fay"; // spouse the viewer can't see
const MILLER = "miller";
const ORTIZ = "ortiz";
const KID = "kid";

const LINKS = new Map([
  [ANN, "100"],
  [BOB, "101"],
  [DAN, "102"],
  [FAY, "103"],
]);

function person(id: string, over: Partial<DirectoryProfile> = {}): DirectoryProfile {
  return {
    id,
    first_name: id,
    last_name: "Seedly",
    preferred_name: null,
    avatar_url: null,
    relationship: "primary",
    family_id: null,
    birth_month: null,
    birth_day: null,
    birth_year: null,
    ...over,
  } as DirectoryProfile;
}

const member = (p: DirectoryProfile) => ({ ...p, is_class_member: true, phone_mobile: null }) as unknown as HouseholdMember;

function rows(stored: (id: string) => Partial<DirectoryProfile>, household: (id: string) => Partial<FamilyDirectoryFull>, kid: Partial<HouseholdFamilyMember>) {
  const people = [
    person(ANN, { family_id: MILLER, ...stored(ANN) }),
    person(BOB, { family_id: MILLER, relationship: "spouse", ...stored(BOB) }),
    person(DAN, stored(DAN)),
    person(EVE, { birth_month: 11, birth_day: 26 }),
    person("other", { family_id: ORTIZ }),
  ];
  const families = [
    {
      id: MILLER,
      family_name: "Miller",
      photo_url: null,
      address_line1: null,
      city: null,
      anniversary_month: null,
      anniversary_day: null,
      anniversary_year: null,
      phone_profile_id: null,
      members: people.filter((p) => p.family_id === MILLER).map(member),
      family_members_list: [
        {
          id: KID,
          first_name: "Kit",
          last_name: "Miller",
          preferred_name: null,
          avatar_url: null,
          relationship: "child",
          is_class_member: false,
          claimed_profile_id: null,
          birth_month: null,
          birth_day: null,
          graduation_year: null,
          ...kid,
        },
      ],
      ...household(MILLER),
    },
    {
      id: ORTIZ,
      family_name: "Ortiz",
      photo_url: null,
      address_line1: null,
      city: null,
      anniversary_month: null,
      anniversary_day: null,
      anniversary_year: null,
      phone_profile_id: null,
      members: [member(people[4])],
      family_members_list: [
        {
          id: "fay-entry",
          first_name: "Fay",
          last_name: "Ortiz",
          preferred_name: null,
          avatar_url: null,
          relationship: "spouse",
          is_class_member: true,
          claimed_profile_id: FAY,
          birth_month: null,
          birth_day: null,
          graduation_year: null,
        },
      ],
      ...household(ORTIZ),
    },
  ] as unknown as FamilyDirectoryFull[];
  return { people, families };
}

const copied = (id: string) => {
  const values = churchValues({ ...RECORDS[id], graduationYear: null } as unknown as RecordsCopyPerson, () => null, TODAY);
  return values;
};

function copyMode() {
  return rows(
    (id) => {
      if (id === DAN) return {}; // cleared by the member
      const b = copied(LINKS.get(id)!).birthday!;
      return { birth_month: b.birth_month as number | null, birth_day: b.birth_day as number | null };
    },
    (id) => {
      if (id !== MILLER) return {};
      const a = copied("100").anniversary!;
      return {
        anniversary_month: a.anniversary_month as number,
        anniversary_day: a.anniversary_day as number,
        anniversary_year: a.anniversary_year as number,
      };
    },
    { birth_month: 11, birth_day: 30, graduation_year: 2034 },
  );
}

function liveMode() {
  const blank = rows(() => ({}), () => ({}), {});
  const sources: LiveSources = {
    fields: new Set(["birthday", "anniversary"]),
    personLinks: LINKS,
    householdLinks: new Map(),
    personStates: new Map([[`${DAN}:birthday`, "cleared"]]),
    addressStates: new Map(),
    children: new Map([[KID, "900"]]),
  };
  const plan = planLiveRequest({
    viewer: { id: EVE, family_id: null, relationship: "primary" },
    // FAY is linked but unlisted, so the viewer's directory read never returns her.
    people: blank.people,
    households: blank.families,
    sources,
  });
  expect(plan.people).not.toContain("103");
  const details: RecordsLiveDetails = {
    people: new Map(
      plan.people.map((id) => [
        id,
        { birthday: RECORDS[id].birthday, anniversary: RECORDS[id].anniversary, graduationYear: RECORDS[id].graduationYear ?? null },
      ]),
    ),
    families: new Map(),
  };
  const live = applyLiveDetails(blank.people, blank.families, liveDirectory(plan, details, TODAY));
  return { people: live.members, families: live.families };
}

describe("live details", () => {
  it("give the same Birthdays and Anniversaries lists as the same details copied into two42", () => {
    const copy = copyMode();
    const live = liveMode();
    for (const includeNonAttendees of [false, true]) {
      expect(birthdayEntries(live.people, live.families, includeNonAttendees)).toEqual(
        birthdayEntries(copy.people, copy.families, includeNonAttendees),
      );
    }
    expect(anniversaryEntries(live.families, TODAY)).toEqual(anniversaryEntries(copy.families, TODAY));
    for (const when of ["week", "month", "all"] as const) {
      expect(celebrationSections(birthdayEntries(live.people, live.families, true), when, TODAY)).toEqual(
        celebrationSections(birthdayEntries(copy.people, copy.families, true), when, TODAY),
      );
      expect(celebrationSections(anniversaryEntries(live.families, TODAY), when, TODAY)).toEqual(
        celebrationSections(anniversaryEntries(copy.families, TODAY), when, TODAY),
      );
    }
  });

  it("show the cases the lists depend on: no birth year, a hidden birthday, an impossible date, a year-less anniversary", () => {
    const { people, families } = liveMode();
    const names = birthdayEntries(people, families, true).map((e) => e.key);
    expect(names).toEqual([`profile-${ANN}`, `profile-${EVE}`, `fm-${KID}`]);
    expect(birthdayEntries(people, families, true).every((e) => !("year" in e))).toBe(true);
    expect(anniversaryEntries(families, TODAY).map((e) => [e.key, e.marriedYear])).toEqual([[MILLER, 1985]]);
  });

  it("change nothing for a church that shows none: the very same rows come back", () => {
    const { people, families } = rows(() => ({}), () => ({}), {});
    for (const live of [null, { mode: "off" } as const]) {
      const merged = applyLiveDetails(people, families, live);
      expect(merged.members).toBe(people);
      expect(merged.families).toBe(families);
    }
    expect(someUnavailable(null, "birthday")).toBe(false);
  });

  it("say when some dates couldn't be read", () => {
    const blank = rows(() => ({}), () => ({}), {});
    const plan = planLiveRequest({
      viewer: { id: EVE, family_id: null, relationship: "primary" },
      people: blank.people,
      households: blank.families,
      sources: {
        fields: new Set(["birthday", "anniversary"]),
        personLinks: LINKS,
        householdLinks: new Map(),
        personStates: new Map(),
        addressStates: new Map(),
        children: new Map(),
      },
    });
    const live = liveDirectory(plan, null, TODAY);
    expect(someUnavailable(live, "birthday")).toBe(true);
    expect(someUnavailable(live, "anniversary")).toBe(true);
    const merged = applyLiveDetails(blank.people, blank.families, live);
    expect(birthdayEntries(merged.members, merged.families, true).map((e) => e.key)).toEqual([`profile-${EVE}`]);
  });

  it("say so for both lists when nothing could be read, without changing a row", () => {
    const { people, families } = rows(() => ({}), () => ({}), {});
    expect(someUnavailable(LIVE_UNAVAILABLE, "birthday")).toBe(true);
    expect(someUnavailable(LIVE_UNAVAILABLE, "anniversary")).toBe(true);
    const merged = applyLiveDetails(people, families, LIVE_UNAVAILABLE);
    expect(merged.members).toEqual(people);
    expect(merged.families).toEqual(families);
  });
});
