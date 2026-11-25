// Suggests which person in the church's records a two42 profile is. A
// suggestion always needs the name to agree: spouses often share an address,
// so an email match alone is never a suggestion. A birthday that disagrees
// rules a person out.
import type { RecordsPerson } from "./types";

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
  personId: string;
  /** The person's name in the records, the only detail from them a church admin sees while matching. */
  personName: string;
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

function namesAgree(profile: ProfileForMatch, person: RecordsPerson): boolean {
  const last = normalizeName(profile.lastName);
  if (!last || last !== normalizeName(person.lastName)) return false;
  const ours = [profile.firstName, profile.preferredName].map(normalizeName).filter(Boolean);
  const theirs = [person.firstName, person.nickName].map(normalizeName).filter(Boolean);
  return ours.some((name) => theirs.includes(name));
}

/** null when the birthdays disagree; otherwise whether they agree on at least month and day. */
function birthdayFact(profile: ProfileForMatch, person: RecordsPerson): boolean | null {
  // A year can be stored without a month or day, and a year that disagrees rules a person out on its own.
  if (profile.birthYear && person.birthYear && profile.birthYear !== person.birthYear) return null;
  if (!profile.birthMonth || !profile.birthDay || !person.birthMonth || !person.birthDay) return false;
  if (profile.birthMonth !== person.birthMonth || profile.birthDay !== person.birthDay) return null;
  return true;
}

/** What agrees between a profile and a person, or null when they can't be the same person. */
export function compare(profile: ProfileForMatch, person: RecordsPerson): MatchFacts | null {
  if (!namesAgree(profile, person)) return null;
  const birthday = birthdayFact(profile, person);
  if (birthday === null) return null;
  const email = normalizeEmail(profile.email);
  return { email: email !== "" && email === normalizeEmail(person.email), birthday };
}

export function displayName(person: RecordsPerson): string {
  const first = person.nickName || person.firstName;
  return [first, person.lastName].filter(Boolean).join(" ");
}

/**
 * Suggestions for profiles not yet linked, best first for each profile.
 * People already linked to another profile are never suggested again.
 * `incompleteLastNames` holds normalized last names whose people couldn't all
 * be read; a competitor may be missing, so those pairs are never bulk-confirmable.
 */
export function suggest(
  profiles: readonly ProfileForMatch[],
  people: readonly RecordsPerson[],
  alreadyLinked: ReadonlySet<string>,
  incompleteLastNames: ReadonlySet<string> = new Set(),
): Suggestion[] {
  const lastNameOf = new Map(profiles.map((p) => [p.id, normalizeName(p.lastName)]));
  const pairs: Omit<Suggestion, "confirmableInBulk">[] = [];
  for (const profile of profiles) {
    for (const person of people) {
      if (alreadyLinked.has(person.id) || !person.linkable) continue;
      const matched = compare(profile, person);
      if (matched) pairs.push({ profileId: profile.id, personId: person.id, personName: displayName(person), matched });
    }
  }
  const perProfile = new Map<string, number>();
  const perPerson = new Map<string, number>();
  for (const pair of pairs) {
    perProfile.set(pair.profileId, (perProfile.get(pair.profileId) ?? 0) + 1);
    perPerson.set(pair.personId, (perPerson.get(pair.personId) ?? 0) + 1);
  }
  const score = (m: MatchFacts) => Number(m.email) + Number(m.birthday);
  return pairs
    .map((pair) => ({
      ...pair,
      confirmableInBulk:
        score(pair.matched) > 0 &&
        perProfile.get(pair.profileId) === 1 &&
        perPerson.get(pair.personId) === 1 &&
        !incompleteLastNames.has(lastNameOf.get(pair.profileId) ?? ""),
    }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId) || score(b.matched) - score(a.matched));
}
