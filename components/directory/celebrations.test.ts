import { describe, expect, it } from "vitest";
import {
  anniversaryEntries,
  birthdayEntries,
  celebrationHref,
  celebrationSections,
  celebrationsThisWeek,
  coupleName,
  isThisWeek,
  parseIncludeNonAttendees,
  parseWhen,
} from "@/components/directory/celebrations";
import {
  calendarDate,
  daysUntilNextOccurrence,
  formatOccurrence,
} from "@/components/directory/utils";
import { todayIn } from "@/lib/serving/dates";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

const NOV_3 = calendarDate("2026-11-03");
const NOV_29 = calendarDate("2026-11-29");

function dated(month: number, day: number) {
  return { name: `${month}/${day}`, month, day };
}

function labels(sections: { label: string; entries: { name: string }[] }[]) {
  return sections.map((s) => [s.label, s.entries.map((e) => e.name)]);
}

function profile(id: string, birth: [number, number] | null): DirectoryProfile {
  return {
    id,
    first_name: id,
    last_name: "Person",
    preferred_name: null,
    avatar_url: null,
    birth_month: birth?.[0] ?? null,
    birth_day: birth?.[1] ?? null,
  } as DirectoryProfile;
}

function household(overrides: Partial<FamilyDirectoryFull>): FamilyDirectoryFull {
  return {
    id: "family",
    family_name: "Miller",
    photo_url: null,
    anniversary_month: null,
    anniversary_day: null,
    anniversary_year: null,
    phone_profile_id: null,
    members: [],
    family_members_list: [],
    ...overrides,
  } as FamilyDirectoryFull;
}

const asMember = (id: string, relationship: string, first_name: string) =>
  ({ id, relationship, first_name, preferred_name: null }) as FamilyDirectoryFull["members"][number];

function householdRecord(
  overrides: Partial<FamilyDirectoryFull["family_members_list"][number]>,
): FamilyDirectoryFull["family_members_list"][number] {
  return {
    id: "fm",
    first_name: "Sam",
    last_name: "Miller",
    preferred_name: null,
    avatar_url: null,
    relationship: "child",
    is_class_member: true,
    birth_month: null,
    birth_day: null,
    claimed_profile_id: null,
    ...overrides,
  };
}

describe("isThisWeek", () => {
  it("is today and the next 6 days", () => {
    expect(isThisWeek(11, 3, NOV_3)).toBe(true);
    expect(isThisWeek(11, 9, NOV_3)).toBe(true);
    expect(isThisWeek(11, 10, NOV_3)).toBe(false);
  });

  it("does not count a date that passed this month", () => {
    expect(isThisWeek(11, 1, NOV_3)).toBe(false);
  });

  it("crosses the end of the year", () => {
    expect(isThisWeek(1, 2, calendarDate("2026-12-29"))).toBe(true);
  });

  it("follows the church's calendar date, not the runtime's, near midnight", () => {
    const lateEveningInNewYork = new Date("2026-11-03T04:30:00Z");
    const churchToday = todayIn("America/New_York", lateEveningInNewYork);
    expect(churchToday).toBe("2026-11-02");
    expect(todayIn("UTC", lateEveningInNewYork)).toBe("2026-11-03");
    expect(isThisWeek(11, 9, calendarDate(churchToday))).toBe(false);
    expect(isThisWeek(11, 2, calendarDate(churchToday))).toBe(true);
  });
});

describe("formatOccurrence", () => {
  it("keeps this year's weekday for a date earlier this month", () => {
    expect(formatOccurrence(11, 1, NOV_3)).toBe("Sunday, November 1");
    expect(formatOccurrence(11, 5, NOV_3)).toBe("Thursday, November 5");
  });

  it("shows the next occurrence for any other month", () => {
    expect(formatOccurrence(2, 27, NOV_3)).toBe("Saturday, February 27");
  });

  it("leaves the count on the next occurrence, so a passed date is never soon", () => {
    expect(daysUntilNextOccurrence(11, 1, NOV_3)).toBe(363);
  });
});

describe("celebrationSections", () => {
  const entries = [dated(11, 28), dated(11, 9), dated(11, 10), dated(11, 1), dated(2, 27), dated(11, 3)];

  it("lists this week in date order under one heading", () => {
    expect(labels(celebrationSections(entries, "week", NOV_3))).toEqual([
      ["This week", ["11/3", "11/9"]],
    ]);
  });

  it("orders this week by date across the new year", () => {
    const today = calendarDate("2026-12-29");
    expect(labels(celebrationSections([dated(1, 2), dated(12, 31)], "week", today))).toEqual([
      ["This week", ["12/31", "1/2"]],
    ]);
  });

  it("groups this month under three headings", () => {
    expect(labels(celebrationSections(entries, "month", NOV_3))).toEqual([
      ["This week", ["11/3", "11/9"]],
      ["Later this month", ["11/10", "11/28"]],
      ["Earlier this month", ["11/1"]],
    ]);
  });

  it("leaves out a heading with no dates", () => {
    expect(labels(celebrationSections([dated(11, 1)], "month", NOV_3))).toEqual([
      ["Earlier this month", ["11/1"]],
    ]);
  });

  it("puts a date in the next month in this week but not this month", () => {
    const entry = [dated(12, 1)];
    expect(labels(celebrationSections(entry, "week", NOV_29))).toEqual([["This week", ["12/1"]]]);
    expect(celebrationSections(entry, "month", NOV_29)).toEqual([]);
  });

  it("shows nothing rather than an empty heading", () => {
    expect(celebrationSections([], "week", NOV_3)).toEqual([]);
    expect(celebrationSections([dated(2, 27)], "month", NOV_3)).toEqual([]);
  });

  it("lists every date by month for all, starting at the current month", () => {
    expect(labels(celebrationSections(entries, "all", NOV_3))).toEqual([
      ["November — this month", ["11/1", "11/3", "11/9", "11/10", "11/28"]],
      ["February", ["2/27"]],
    ]);
  });

  it("files February 29 by the date a row shows in a year without one", () => {
    const leapling = [dated(2, 29)];
    const march = calendarDate("2027-03-03");
    expect(labels(celebrationSections(leapling, "month", march))).toEqual([
      ["Earlier this month", ["2/29"]],
    ]);
    expect(formatOccurrence(2, 29, march)).toBe("Monday, March 1");
  });
});

describe("parseWhen", () => {
  it("opens at all for a missing or unknown value", () => {
    expect(parseWhen("week")).toBe("week");
    expect(parseWhen("month")).toBe("month");
    expect(parseWhen(null)).toBe("all");
    expect(parseWhen("year")).toBe("all");
  });
});

describe("birthdayEntries", () => {
  const families = [
    household({
      family_members_list: [
        householdRecord({ id: "attends", is_class_member: true, birth_month: 11, birth_day: 4 }),
        householdRecord({ id: "home", is_class_member: false, birth_month: 11, birth_day: 5 }),
        householdRecord({ id: "claimed", claimed_profile_id: "p", birth_month: 11, birth_day: 6 }),
        householdRecord({ id: "no-date" }),
      ],
    }),
  ];

  it("opens a person's profile, and the household of someone without an account", () => {
    const entries = birthdayEntries([profile("p", [11, 4])], families, false);
    expect(entries.map((e) => e.path)).toEqual([
      "/families?person=p",
      "/families?family=family",
    ]);
  });

  it("adds household members who don't attend a group only on request", () => {
    const keys = (include: boolean) => birthdayEntries([], families, include).map((e) => e.key);
    expect(keys(false)).toEqual(["fm-attends"]);
    expect(keys(true)).toEqual(["fm-attends", "fm-home"]);
  });

  it("leaves out a birthday the view hid", () => {
    expect(birthdayEntries([profile("hidden", null)], [], true)).toEqual([]);
  });
});

describe("anniversaryEntries", () => {
  const couple = {
    anniversary_month: 11,
      anniversary_day: 5,
      anniversary_year: 2004,
    members: [asMember("a", "primary", "Frank"), asMember("b", "spouse", "Susan")],
  };

  it("opens the household and names the couple", () => {
    const [entry] = anniversaryEntries([household(couple)], NOV_3);
    expect(entry).toMatchObject({
      path: "/families?family=family",
      coupleName: "Frank & Susan Miller",
      month: 11,
      day: 5,
      marriedYear: 2004,
      years: 22,
    });
  });

  it("keeps a couple with no year, and leaves the year and count out", () => {
    const [entry] = anniversaryEntries(
      [household({ ...couple, anniversary_year: null })],
      NOV_3,
    );
    expect(entry).toMatchObject({ month: 11, day: 5, marriedYear: null, years: null });
  });

  it("shows nothing from the old date column, which a hidden anniversary can still be in", () => {
    const oldView = {
      ...household({ members: couple.members }),
      anniversary: "2004-11-05",
    } as FamilyDirectoryFull;
    delete (oldView as Partial<FamilyDirectoryFull>).anniversary_month;
    delete (oldView as Partial<FamilyDirectoryFull>).anniversary_day;
    delete (oldView as Partial<FamilyDirectoryFull>).anniversary_year;
    expect(anniversaryEntries([oldView], NOV_3)).toEqual([]);
  });

  it("names a spouse without an account", () => {
    const family = household({
      anniversary_month: 11,
      anniversary_day: 5,
      anniversary_year: 2004,
      members: [asMember("a", "primary", "Frank")],
      family_members_list: [householdRecord({ first_name: "Susan", relationship: "spouse" })],
    });
    expect(coupleName(family)).toBe("Frank & Susan Miller");
    expect(anniversaryEntries([family], NOV_3)).toHaveLength(1);
  });

  it("leaves out a household with no anniversary on record or no spouse", () => {
    const families = [
      household({ ...couple, anniversary_month: null, anniversary_day: null, anniversary_year: null }),
      household({ ...couple, members: [asMember("a", "primary", "Frank")] }),
    ];
    expect(anniversaryEntries(families, NOV_3)).toEqual([]);
  });

  it("keeps a couple whose claimed spouse is unlisted or pending, and never names that spouse", () => {
    const family = household({
      anniversary_month: 11,
      anniversary_day: 5,
      anniversary_year: 2004,
      members: [asMember("a", "primary", "Frank")],
      family_members_list: [
        householdRecord({ first_name: "Susan", relationship: "spouse", claimed_profile_id: "b" }),
      ],
    });
    expect(anniversaryEntries([family], NOV_3).map((e) => e.coupleName)).toEqual(["Frank Miller"]);
  });
});

describe("celebrationsThisWeek", () => {
  const groupId = "group";
  const inGroup = profile("in-group", [11, 9]);
  const later = profile("later", [11, 10]);
  const elsewhere = profile("elsewhere", [11, 5]);
  const families = [
    household({
      id: "in-group-household",
      family_name: "Miller",
      anniversary_month: 11,
      anniversary_day: 4,
      anniversary_year: 2004,
      members: [asMember("in-group", "primary", "Frank"), asMember("b", "spouse", "Susan")],
      family_members_list: [
        householdRecord({ id: "kid", is_class_member: false, birth_month: 11, birth_day: 4 }),
      ],
    }),
    household({
      id: "other-household",
      family_name: "Okafor",
      anniversary_month: 11,
      anniversary_day: 4,
      anniversary_year: 2004,
      members: [asMember("elsewhere", "primary", "Ruth"), asMember("c", "spouse", "Sam")],
    }),
  ];
  const input = {
    members: [inGroup, later, elsewhere],
    families,
    groupId,
    rosters: { [groupId]: new Set(["in-group", "later"]) },
    today: NOV_3,
  };

  it("names this group's people and couples, without non-attending household members", () => {
    const { birthdays, anniversaries } = celebrationsThisWeek(input);
    expect(birthdays.map((b) => b.name)).toEqual(["in-group Person"]);
    expect(anniversaries.map((a) => a.coupleName)).toEqual(["Frank & Susan Miller"]);
  });

  it("names exactly who the tab lists under this week", () => {
    const scoped = [inGroup, later];
    const tab = celebrationSections(birthdayEntries(scoped, [families[0]], false), "week", NOV_3);
    expect(celebrationsThisWeek(input).birthdays).toEqual(tab[0].entries);
  });
});

describe("celebrationHref", () => {
  const href = "/directory/birthdays";

  it("sets a value and keeps the others", () => {
    expect(celebrationHref(href, "household=all", "when", "week")).toBe(
      `${href}?household=all&when=week`,
    );
    expect(celebrationHref(href, "when=week", "household", "all")).toBe(
      `${href}?when=week&household=all`,
    );
  });

  it("replaces a value rather than adding a second one", () => {
    expect(celebrationHref(href, "when=week", "when", "month")).toBe(`${href}?when=month`);
  });

  it("clears a value, leaving no stray question mark", () => {
    expect(celebrationHref(href, "when=week&household=all", "household", null)).toBe(
      `${href}?when=week`,
    );
    expect(celebrationHref(href, "when=week", "when", null)).toBe(href);
  });
});

describe("parseIncludeNonAttendees", () => {
  it("is on only for the value the switch writes", () => {
    expect(parseIncludeNonAttendees("all")).toBe(true);
    expect(parseIncludeNonAttendees(null)).toBe(false);
    expect(parseIncludeNonAttendees("true")).toBe(false);
  });
});
