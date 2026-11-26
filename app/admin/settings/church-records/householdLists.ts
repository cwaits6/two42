// How the church admin's household suggestions are sorted, searched and put
// into words. Every name is two42's own: people's names and households' names
// here, never the records'.
import { relLabel } from "@/components/directory/utils";
import { search } from "./linkLists";

export interface SuggestedPersonRow {
  profileId: string;
  name: string;
  from: { familyId: string; name: string } | null;
  moves: boolean;
  relationship: string;
  relationshipChanges: boolean;
}

export interface HouseholdSuggestionRow {
  id: string;
  ready: boolean;
  target: { familyId: string; name: string } | { newName: string };
  people: SuggestedPersonRow[];
}

export interface HouseholdsData {
  suggestChildren: boolean;
  lastRefreshedAt: string | null;
  householdsUnavailable: boolean;
  suggestions: HouseholdSuggestionRow[];
}

/** A suggestion with the text it's searched by: everyone's name and the households'. */
type Searchable = HouseholdSuggestionRow & { name: string };

const searchable = (s: HouseholdSuggestionRow): Searchable => ({
  ...s,
  name: [
    ...s.people.map((p) => p.name),
    ...s.people.map((p) => p.from?.name ?? ""),
    "familyId" in s.target ? s.target.name : s.target.newName,
  ].join(" "),
});

/** Ready: nobody leaves a household, so they can be confirmed together. Check first: everything else. */
export function householdSections(data: HouseholdsData, query: string) {
  const found = search(data.suggestions.map(searchable), query);
  return { ready: found.filter((s) => s.ready), checkFirst: found.filter((s) => !s.ready) };
}

export function householdTitle(target: HouseholdSuggestionRow["target"]): string {
  return "familyId" in target ? `the ${target.name} household` : `a new household: ${target.newName}`;
}

function list(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The question a suggestion asks the church admin. */
export function suggestionQuestion(s: HouseholdSuggestionRow): string {
  if (s.people.length === 0) {
    return `Everyone your church's records list in this family is in the ${"familyId" in s.target ? s.target.name : s.target.newName} household. Link it, so it gets the family's details?`;
  }
  const movers = s.people.filter((p) => p.moves).map((p) => p.name);
  if (movers.length === 0) return `Update relationships in ${householdTitle(s.target)}?`;
  return `Your church's records list ${list(s.people.map((p) => p.name))} in one family. Put them in ${householdTitle(s.target)}?`;
}

/** What confirming changes for one person. */
export function personLine(p: SuggestedPersonRow): string {
  const now = p.from ? `In the ${p.from.name} household` : "No household";
  const parts = [now];
  if (p.moves) parts.push(p.from ? "moves" : "joins");
  if (p.relationshipChanges || p.moves) parts.push(`as ${relLabel(p.relationship)}`);
  return parts.join(" · ");
}
