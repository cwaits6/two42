// How the church admin's link lists are sorted into sections, searched and
// paged. A church can have thousands of people, so nothing here renders a
// whole list at once.

export interface SuggestionRow {
  profileId: string;
  name: string;
  personId: string;
  personName: string;
  personUrl: string;
  matched: { email: boolean; birthday: boolean };
  confirmableInBulk: boolean;
}

export interface LinkedRow {
  profileId: string;
  name: string;
  personId: string;
  personUrl: string;
  linkedAt: string;
}

export interface UnmatchedRow {
  profileId: string;
  name: string;
}

export interface LinksData {
  linked: LinkedRow[];
  suggestions: SuggestionRow[];
  unmatched: UnmatchedRow[];
}

/** A profile that needs a look before linking, with every person it could be. */
export interface CheckFirstRow {
  profileId: string;
  name: string;
  candidates: SuggestionRow[];
}

export interface LinkSections {
  ready: SuggestionRow[];
  checkFirst: CheckFirstRow[];
  noMatch: UnmatchedRow[];
}

export const PAGE_SIZE = 25;
/** The most pairs the links route accepts in one request. */
export const BATCH_SIZE = 100;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Ready: suggestions the server would link in bulk (only one possible match on
 * each side). Check first: every other suggestion, one row per profile.
 */
export function sections(data: LinksData): LinkSections {
  const ready = data.suggestions.filter((s) => s.confirmableInBulk).sort(byName);
  const groups = new Map<string, CheckFirstRow>();
  for (const s of data.suggestions) {
    if (s.confirmableInBulk) continue;
    const group = groups.get(s.profileId) ?? { profileId: s.profileId, name: s.name, candidates: [] };
    group.candidates.push(s);
    groups.set(s.profileId, group);
  }
  return {
    ready,
    checkFirst: [...groups.values()].sort(byName),
    noMatch: [...data.unmatched].sort(byName),
  };
}

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** The rows whose two42 name contains the search, ignoring case and accents. */
export function search<T extends { name: string }>(rows: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const name = fold(row.name);
    return words.every((word) => name.includes(word));
  });
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

/** One page of rows; a page past the end shows the last page. */
export function page<T>(rows: readonly T[], index: number): { rows: T[]; index: number; count: number } {
  const count = pageCount(rows.length);
  const clamped = Math.min(Math.max(0, index), count - 1);
  return { rows: rows.slice(clamped * PAGE_SIZE, (clamped + 1) * PAGE_SIZE), index: clamped, count };
}

export function batches<T>(rows: readonly T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** What agreed besides the name, in words. */
export function matchedText(matched: SuggestionRow["matched"]): string {
  if (matched.email && matched.birthday) return "Name, email and birthday match";
  if (matched.email) return "Name and email match";
  if (matched.birthday) return "Name and birthday match";
  return "Only the name matches";
}

export const count = (n: number) => n.toLocaleString("en-US");
export const people = (n: number) => (n === 1 ? "1 person" : `${count(n)} people`);
