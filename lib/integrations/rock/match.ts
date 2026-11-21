// Suggests which Rock person a two42 profile is. A suggestion always needs the
// name to agree: spouses often share an address, so an email match alone is
// never a suggestion. A birthday that disagrees rules a person out.
import type { PersonFilterIds, RockPerson } from "./client";

export interface ProfileForMatch {
  id: string;
  firstName: string | null;
  preferredName: string | null;
  lastName: string | null;
  email: string | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
}

export interface MatchFacts {
  email: boolean;
  birthday: boolean;
}

export interface Suggestion {
  profileId: string;
  rockPersonId: number;
  /** The Rock person's name, the only Rock detail a church admin sees while matching. */
  rockName: string;
  matched: MatchFacts;
  /**
   * Whether this can be confirmed together with others: the name and at least
   * one more fact agree, and neither side has another candidate.
   */
  confirmableInBulk: boolean;
}

/** Lowercased, accents and punctuation removed, so "José O'Brien" and "jose obrien" agree. */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const normalizeEmail = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/** Whether Rock's record is one two42 may link: a living person, not a business or an inactive record. */
export function linkable(person: RockPerson, ids: PersonFilterIds): boolean {
  if (person.isDeceased) return false;
  if (person.recordTypeValueId !== ids.recordTypePerson) return false;
  return ids.recordStatusInactive === null || person.recordStatusValueId !== ids.recordStatusInactive;
}

function namesAgree(profile: ProfileForMatch, person: RockPerson): boolean {
  const last = normalizeName(profile.lastName);
  if (!last || last !== normalizeName(person.lastName)) return false;
  const ours = [profile.firstName, profile.preferredName].map(normalizeName).filter(Boolean);
  const theirs = [person.firstName, person.nickName].map(normalizeName).filter(Boolean);
  return ours.some((name) => theirs.includes(name));
}

/** null when the birthdays disagree; otherwise whether they agree on at least month and day. */
function birthdayFact(profile: ProfileForMatch, person: RockPerson): boolean | null {
  if (!profile.birthMonth || !profile.birthDay || !person.birthMonth || !person.birthDay) return false;
  if (profile.birthMonth !== person.birthMonth || profile.birthDay !== person.birthDay) return null;
  if (profile.birthYear && person.birthYear && profile.birthYear !== person.birthYear) return null;
  return true;
}

/** What agrees between a profile and a Rock person, or null when they can't be the same person. */
export function compare(profile: ProfileForMatch, person: RockPerson): MatchFacts | null {
  if (!namesAgree(profile, person)) return null;
  const birthday = birthdayFact(profile, person);
  if (birthday === null) return null;
  const email = normalizeEmail(profile.email);
  return { email: email !== "" && email === normalizeEmail(person.email), birthday };
}

export function displayName(person: RockPerson): string {
  const first = person.nickName || person.firstName;
  return [first, person.lastName].filter(Boolean).join(" ");
}

/**
 * Suggestions for profiles not yet linked, best first for each profile.
 * People already linked to another profile are never suggested again.
 */
export function suggest(
  profiles: readonly ProfileForMatch[],
  people: readonly RockPerson[],
  ids: PersonFilterIds,
  alreadyLinked: ReadonlySet<number>,
): Suggestion[] {
  const pairs: Omit<Suggestion, "confirmableInBulk">[] = [];
  for (const profile of profiles) {
    for (const person of people) {
      if (alreadyLinked.has(person.id) || !linkable(person, ids)) continue;
      const matched = compare(profile, person);
      if (matched) pairs.push({ profileId: profile.id, rockPersonId: person.id, rockName: displayName(person), matched });
    }
  }
  const perProfile = new Map<string, number>();
  const perPerson = new Map<number, number>();
  for (const pair of pairs) {
    perProfile.set(pair.profileId, (perProfile.get(pair.profileId) ?? 0) + 1);
    perPerson.set(pair.rockPersonId, (perPerson.get(pair.rockPersonId) ?? 0) + 1);
  }
  const score = (m: MatchFacts) => Number(m.email) + Number(m.birthday);
  return pairs
    .map((pair) => ({
      ...pair,
      confirmableInBulk:
        score(pair.matched) > 0 && perProfile.get(pair.profileId) === 1 && perPerson.get(pair.rockPersonId) === 1,
    }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId) || score(b.matched) - score(a.matched));
}
