import { pairKey } from "./shuffle";

/**
 * This season's parties who shared a table in earlier seasons. Party ids are
 * new each season, so the match goes through the people: two parties are a
 * pair when someone in one sat at a table with someone in the other, in
 * different parties. Each past table is its parties' people.
 */
export function pastPairsFromHistory(
  current: { id: string; profileIds: string[] }[],
  pastTables: string[][][]
): [string, string][] {
  const partyOf = new Map<string, string>();
  for (const party of current) for (const profileId of party.profileIds) partyOf.set(profileId, party.id);
  const pairs = new Map<string, [string, string]>();
  for (const table of pastTables) {
    const nowIn = table.map((people) => [...new Set(people.flatMap((id) => partyOf.get(id) ?? []))]);
    for (let a = 0; a < nowIn.length; a++) {
      for (let b = a + 1; b < nowIn.length; b++) {
        for (const x of nowIn[a]) {
          for (const y of nowIn[b]) {
            if (x !== y) pairs.set(pairKey(x, y), x < y ? [x, y] : [y, x]);
          }
        }
      }
    }
  }
  return [...pairs.values()];
}
