// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarDate } from "@/components/directory/utils";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

const directory = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const search = vi.hoisted(() => ({ when: null as string | null }));

vi.mock("@/components/directory/DirectoryContext", () => ({
  useDirectory: () => directory.value,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.when ? `when=${search.when}` : ""),
}));

import { AnniversariesTab } from "./AnniversariesTab";
import { BirthdaysTab } from "./BirthdaysTab";

const person = (id: string, month: number, day: number) =>
  ({
    id,
    first_name: id,
    last_name: "Sample",
    preferred_name: null,
    avatar_url: null,
    birth_month: month,
    birth_day: day,
  }) as DirectoryProfile;

const couple = (id: string, family_name: string, anniversary: string) =>
  ({
    id,
    family_name,
    anniversary,
    photo_url: null,
    members: [
      { id: `${id}-a`, relationship: "primary", first_name: "Frank", preferred_name: null },
      { id: `${id}-b`, relationship: "spouse", first_name: "Susan", preferred_name: null },
    ],
    family_members_list: [],
  }) as unknown as FamilyDirectoryFull;

function provide(members: DirectoryProfile[], families: FamilyDirectoryFull[]) {
  directory.value = {
    members,
    families,
    basePath: "/g/group/directory",
    today: calendarDate("2026-11-03"),
    loading: false,
    error: false,
    reload: () => {},
  };
}

function render(when: string | null, tab: typeof BirthdaysTab | typeof AnniversariesTab) {
  search.when = when;
  return renderToStaticMarkup(createElement(tab));
}

beforeEach(() => {
  // A browser clock a day ahead of the church's calendar date, which must not be read.
  vi.useFakeTimers({ now: new Date(2026, 10, 4, 0, 30) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BirthdaysTab", () => {
  beforeEach(() => {
    provide([person("Soon", 11, 4), person("Later", 11, 20), person("Passed", 11, 1)], []);
  });

  it("marks the current filter and offers the others as links", () => {
    const html = render("week", BirthdaysTab);
    expect(html).toMatch(
      /aria-current="page"[^>]*href="\/g\/group\/directory\/birthdays\?when=week"/,
    );
    expect(html).toContain('href="/g/group/directory/birthdays?when=month"');
    expect(html).toContain('href="/g/group/directory/birthdays"');
  });

  it("keeps the pill on all, and reads today from the context", () => {
    const html = render(null, BirthdaysTab);
    expect(html).toContain("Tomorrow");
    expect(html).toContain("November — this month");
  });

  it("drops the pill on this week and this month", () => {
    for (const when of ["week", "month"]) {
      const html = render(when, BirthdaysTab);
      expect(html).toContain("Soon Sample");
      expect(html).not.toContain("Tomorrow");
      expect(html).not.toContain("bg-brand-warm border-brand-primary/40");
    }
  });

  it("selects only this week's people on this week", () => {
    const html = render("week", BirthdaysTab);
    expect(html).toContain("Soon Sample");
    expect(html).not.toContain("Later Sample");
    expect(html).not.toContain("Passed Sample");
  });

  it("files a passed date under earlier this month, with this year's weekday", () => {
    const html = render("month", BirthdaysTab);
    expect(html).toContain("Earlier this month");
    expect(html).toContain("Sunday, November 1");
  });

  it("links a household member without an account to their household", () => {
    provide(
      [],
      [
        {
          ...couple("household", "Miller", "2004-05-15"),
          family_members_list: [
            {
              id: "fm",
              first_name: "Theo",
              last_name: "Miller",
              preferred_name: null,
              avatar_url: null,
              relationship: "child",
              is_class_member: true,
              birth_month: 11,
              birth_day: 4,
              birth_year: null,
              claimed_profile_id: null,
            },
          ],
        },
      ],
    );
    expect(render(null, BirthdaysTab)).toContain(
      'href="/g/group/directory/families?family=household"',
    );
  });

  it("says when a filter is empty and links onward, keeping the switch", () => {
    provide([person("Far", 2, 27)], []);
    const week = render("week", BirthdaysTab);
    expect(week).toContain("No birthdays this week.");
    expect(week).toContain(">Show this month<");
    expect(week).toContain("include-non-attendees");
    const month = render("month", BirthdaysTab);
    expect(month).toContain("No birthdays this month.");
    expect(month).toContain(">Show all<");
  });
});

describe("AnniversariesTab", () => {
  beforeEach(() => {
    provide([], [couple("soon", "Bell", "2004-11-05"), couple("later", "Reyes", "2010-11-21")]);
  });

  it("puts the marriage year on its own line and keeps the pill on all", () => {
    const html = render(null, AnniversariesTab);
    expect(html).toContain("Thursday, November 5");
    expect(html).toContain("Married 2004");
    expect(html).not.toContain("· married");
    expect(html).toContain("22 years");
  });

  it("drops the pill on this month, under the headings", () => {
    const html = render("month", AnniversariesTab);
    expect(html).toContain("This week");
    expect(html).toContain("Later this month");
    expect(html).not.toContain("22 years");
  });

  it("says when a filter is empty and links onward", () => {
    provide([], [couple("far", "Bell", "2004-02-27")]);
    expect(render("week", AnniversariesTab)).toContain("No anniversaries this week.");
    expect(render("month", AnniversariesTab)).toContain("No anniversaries this month.");
  });
});
