// Who has a birthday or anniversary when. Pure, so a server component can read
// the same people, in the same order, that the Directory tabs render.

import { scopeFamilies, scopeMembers, type GroupRosters } from "@/components/directory/scope";
import {
  MONTH_NAMES,
  daysUntilNextOccurrence,
  isInCurrentMonth,
  monthCycle,
  nextOccurrence,
  occurrenceThisYear,
} from "@/components/directory/utils";
import { displayName, initials } from "@/lib/names";
import type { DirectoryProfile, FamilyDirectoryFull } from "@/lib/types";

export type CelebrationWhen = "week" | "month" | "all";

export function parseWhen(value: string | null): CelebrationWhen {
  return value === "week" || value === "month" ? value : "all";
}

/** Whether the URL has the Birthdays tab showing household members who don't attend a group. */
export function parseIncludeNonAttendees(value: string | null): boolean {
  return value === "all";
}

/**
 * `href` with one query value set or cleared and the others kept, so the filter
 * and the household switch carry each other through a link.
 */
export function celebrationHref(
  href: string,
  search: string,
  name: "when" | "household",
  value: string | null,
): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  const query = params.toString();
  return query ? `${href}?${query}` : href;
}

interface RecurringDate {
  month: number;
  day: number;
}

export interface BirthdayEntry extends RecurringDate {
  key: string;
  /** Under the directory's base path: the person's profile, or the household of someone without an account */
  path: string;
  name: string;
  avatarUrl: string | null;
  initials: string;
}

export interface AnniversaryEntry extends RecurringDate {
  key: string;
  /** Under the directory's base path: the household */
  path: string;
  coupleName: string;
  photoUrl: string | null;
  initial: string;
  /** Null when the couple gave no year, so "Married" and the count are left out. */
  marriedYear: number | null;
  years: number | null;
}

export interface CelebrationSection<T> {
  label: string;
  entries: T[];
}

/** Today and the next 6 days. */
export function isThisWeek(month: number, day: number, today: Date): boolean {
  return daysUntilNextOccurrence(month, day, today) < 7;
}

/**
 * The spouse a couple can be shown with. A claimed spouse counts only when
 * their profile is in `members`: the view drops an unlisted or pending profile
 * from there but keeps their family_members row, and nothing in the row tells
 * the two apart.
 */
function nameableSpouse(family: FamilyDirectoryFull) {
  return (
    family.members.find((m) => m.relationship === "spouse") ||
    family.family_members_list.find(
      (fm) =>
        fm.relationship === "spouse" &&
        (!fm.claimed_profile_id || family.members.some((m) => m.id === fm.claimed_profile_id)),
    )
  );
}

/** "Frank & Susan Miller" — the couple's first names plus the family name */
export function coupleName(family: FamilyDirectoryFull): string {
  const primary = family.members.find((m) => m.relationship === "primary");
  const firsts = [primary, nameableSpouse(family)]
    .filter(Boolean)
    .map((p) => p!.preferred_name || p!.first_name)
    .filter(Boolean)
    .join(" & ");
  return firsts ? `${firsts} ${family.family_name}` : family.family_name;
}

/**
 * Everyone with a birthday on record. The views drop unlisted people. A
 * household record claimed by a profile is skipped: the profile speaks for
 * that person.
 */
export function birthdayEntries(
  members: readonly DirectoryProfile[],
  families: readonly FamilyDirectoryFull[],
  includeNonAttendees: boolean,
): BirthdayEntry[] {
  const result: BirthdayEntry[] = [];

  for (const m of members) {
    if (!m.birth_month || !m.birth_day) continue;
    result.push({
      key: `profile-${m.id}`,
      path: `/families?person=${m.id}`,
      name: displayName(m),
      avatarUrl: m.avatar_url,
      initials: initials(m),
      month: m.birth_month,
      day: m.birth_day,
    });
  }

  for (const family of families) {
    for (const fm of family.family_members_list) {
      if (fm.claimed_profile_id || !fm.birth_month || !fm.birth_day) continue;
      if (!fm.is_class_member && !includeNonAttendees) continue;
      result.push({
        key: `fm-${fm.id}`,
        path: `/families?family=${family.id}`,
        name: displayName(fm),
        avatarUrl: fm.avatar_url,
        initials: initials(fm),
        month: fm.birth_month,
        day: fm.birth_day,
      });
    }
  }

  return result;
}

/** Every couple whose household has an anniversary on record. */
export function anniversaryEntries(
  families: readonly FamilyDirectoryFull[],
  today: Date,
): AnniversaryEntry[] {
  const result: AnniversaryEntry[] = [];

  for (const family of families) {
    const month = family.anniversary_month;
    const day = family.anniversary_day;
    const year = family.anniversary_year;
    if (!month || !day || !nameableSpouse(family)) continue;

    result.push({
      key: family.id,
      path: `/families?family=${family.id}`,
      coupleName: coupleName(family),
      photoUrl: family.photo_url,
      initial: family.family_name.charAt(0).toUpperCase(),
      month,
      day,
      marriedYear: year,
      years: year === null ? null : nextOccurrence(month, day, today).getFullYear() - year,
    });
  }

  return result;
}

function thisWeek<T extends RecurringDate>(entries: readonly T[], today: Date): T[] {
  const daysUntil = (e: T) => daysUntilNextOccurrence(e.month, e.day, today);
  return entries
    .filter((e) => isThisWeek(e.month, e.day, today))
    .sort((a, b) => daysUntil(a) - daysUntil(b));
}

function thisMonth<T extends RecurringDate>(
  entries: readonly T[],
  today: Date,
): CelebrationSection<T>[] {
  const date = (e: T) => occurrenceThisYear(e.month, e.day, today);
  const inMonth = entries
    .filter((e) => isInCurrentMonth(e.month, e.day, today))
    .sort((a, b) => date(a).getTime() - date(b).getTime());
  const week = (e: T) => isThisWeek(e.month, e.day, today);
  const passed = (e: T) => date(e) < today;
  return [
    { label: "This week", entries: inMonth.filter(week) },
    { label: "Later this month", entries: inMonth.filter((e) => !week(e) && !passed(e)) },
    { label: "Earlier this month", entries: inMonth.filter(passed) },
  ];
}

function byMonth<T extends RecurringDate>(
  entries: readonly T[],
  today: Date,
): CelebrationSection<T>[] {
  const currentMonth = today.getMonth() + 1;
  return monthCycle(currentMonth).map((month) => ({
    label: `${MONTH_NAMES[month - 1]}${month === currentMonth ? " — this month" : ""}`,
    entries: entries.filter((e) => e.month === month).sort((a, b) => a.day - b.day),
  }));
}

/** The lists a filter shows, in display order, with empty ones left out. */
export function celebrationSections<T extends RecurringDate>(
  entries: readonly T[],
  when: CelebrationWhen,
  today: Date,
): CelebrationSection<T>[] {
  const sections =
    when === "week"
      ? [{ label: "This week", entries: thisWeek(entries, today) }]
      : when === "month"
        ? thisMonth(entries, today)
        : byMonth(entries, today);
  return sections.filter((s) => s.entries.length > 0);
}

/**
 * Who has a birthday or anniversary this week, as a group's directory opens:
 * scoped to that group, without household members who don't attend one.
 * `today` comes from calendarDate(todayIn(zone)) in the church's time zone.
 */
export function celebrationsThisWeek(input: {
  members: readonly DirectoryProfile[];
  families: readonly FamilyDirectoryFull[];
  groupId: string;
  rosters: GroupRosters;
  today: Date;
}): { birthdays: BirthdayEntry[]; anniversaries: AnniversaryEntry[] } {
  const { groupId, rosters, today } = input;
  const scope = { kind: "group", groupId } as const;
  const members = scopeMembers(input.members, scope, rosters, [groupId]);
  const families = scopeFamilies(input.families, scope, rosters, [groupId]);
  return {
    birthdays: thisWeek(birthdayEntries(members, families, false), today),
    anniversaries: thisWeek(anniversaryEntries(families, today), today),
  };
}
