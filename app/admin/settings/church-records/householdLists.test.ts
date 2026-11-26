import { describe, expect, it } from "vitest";
import { householdSections, personLine, suggestionQuestion, type HouseholdSuggestionRow } from "./householdLists";

const henry = { profileId: "p-h", name: "Henry Mockingham", from: { familyId: "f-1", name: "Mockingham" }, moves: false, relationship: "primary", relationshipChanges: false };
const isaac = { profileId: "p-i", name: "Isaac Seedly", from: { familyId: "f-2", name: "Seedly" }, moves: true, relationship: "other", relationshipChanges: true };
const nobody = { profileId: "p-n", name: "Nora New", from: null, moves: true, relationship: "spouse", relationshipChanges: true };

const into = (people: HouseholdSuggestionRow["people"], ready: boolean, id = "s"): HouseholdSuggestionRow => ({
  id,
  ready,
  target: { familyId: "f-1", name: "Mockingham" },
  people,
});

describe("householdSections", () => {
  const data = {
    suggestChildren: false,
    lastRefreshedAt: null,
    householdsUnavailable: false,
    suggestions: [into([henry, nobody], true, "a"), into([henry, isaac], false, "b")],
  };

  it("puts a suggestion where someone leaves a household under Check first", () => {
    const { ready, checkFirst } = householdSections(data, "");
    expect(ready.map((s) => s.id)).toEqual(["a"]);
    expect(checkFirst.map((s) => s.id)).toEqual(["b"]);
  });

  it("searches people's and households' names", () => {
    expect(householdSections(data, "seedly").checkFirst.map((s) => s.id)).toEqual(["b"]);
    expect(householdSections(data, "nora").ready.map((s) => s.id)).toEqual(["a"]);
    expect(householdSections(data, "nobody here").ready).toEqual([]);
  });
});

describe("suggestion text", () => {
  it("names the people and the household they go to", () => {
    expect(suggestionQuestion(into([henry, isaac], false))).toBe(
      "Your church's records list Henry Mockingham and Isaac Seedly in one family. Put them in the Mockingham household?",
    );
    expect(
      suggestionQuestion({ id: "n", ready: true, target: { newName: "New" }, people: [nobody] }),
    ).toBe("Your church's records list Nora New in one family. Put them in a new household: New?");
  });

  it("asks to link a household nobody needs to move into", () => {
    expect(suggestionQuestion(into([], true))).toContain("Link it");
  });

  it("says what changes for each person", () => {
    expect(personLine(isaac)).toBe("In the Seedly household · moves · as Other");
    expect(personLine(nobody)).toBe("No household · joins · as Spouse");
    expect(personLine({ ...henry, relationship: "spouse", relationshipChanges: true })).toBe(
      "In the Mockingham household · as Spouse",
    );
  });
});
