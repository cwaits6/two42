import { describe, expect, it } from "vitest";
import { normalizeEmail, titleCaseName, titleCaseStreet } from "@/lib/sanitize";

// [typed, saved, saved by the rule before mixed capitals were kept]. The import
// matches saved rows on the lowercased name, so the third column pins that only
// capitals moved.
const NAMES: [string, string, string][] = [
  ["john MCDONALD", "John McDonald", "John McDonald"],
  ["JOHN MCDONALD", "John McDonald", "John McDonald"],
  ["JOHN SMITH", "John Smith", "John Smith"],
  ["john smith", "John Smith", "John Smith"],
  ["John smith", "John Smith", "John Smith"],
  ["  john   smith ", "John Smith", "John Smith"],
  ["mARY o'brien", "Mary O'Brien", "Mary O'Brien"],
  ["O'Brien", "O'Brien", "O'Brien"],
  ["o'brien-smith", "O'Brien-Smith", "O'Brien-smith"],
  ["D'Angelo", "D'Angelo", "D'Angelo"],
  ["jean-luc PICARD", "Jean-Luc Picard", "Jean-Luc Picard"],
  ["Mary-Jane", "Mary-Jane", "Mary-Jane"],
  ["mary-jane", "Mary-Jane", "Mary-Jane"],
  ["Mack", "Mack", "MacK"],
  ["mack", "Mack", "MacK"],
  ["MACK", "Mack", "MacK"],
  ["Machado", "Machado", "MacHado"],
  ["MacDonald", "MacDonald", "MacDonald"],
  ["macdonald", "Macdonald", "MacDonald"],
  ["MACDONALD", "Macdonald", "MacDonald"],
  ["McKay", "McKay", "McKay"],
  ["mckay", "McKay", "McKay"],
  ["McDONALD", "McDonald", "McDonald"],
  ["DeSantis", "DeSantis", "Desantis"],
  ["deSantis", "DeSantis", "Desantis"],
  ["desantis", "Desantis", "Desantis"],
  ["LaToya", "LaToya", "Latoya"],
  ["ana VAN DER berg", "Ana van der Berg", "Ana van der Berg"],
  ["Ana Van Der Berg", "Ana van der Berg", "Ana van der Berg"],
  ["van der berg", "Van der Berg", "Van der Berg"],
  ["VAN DER BERG", "Van der Berg", "Van der Berg"],
  ["van der Berg", "van der Berg", "Van der Berg"],
  ["van der BERG", "Van der Berg", "Van der Berg"],
  ["de la Cruz", "de la Cruz", "De la Cruz"],
  ["henry iii", "Henry III", "Henry III"],
  ["ßmith", "Ssmith", "SSmith"],
  ["ﬁnn o'ﬂaherty", "Finn O'Flaherty", "FInn O'FLaherty"],
  ["ǆenan", "Ǆenan", "Ǆenan"],
];

describe("titleCaseName", () => {
  it.each(NAMES)("turns %j into %j", (raw, expected) => {
    expect(titleCaseName(raw)).toBe(expected);
  });

  it.each(NAMES)("changes only the capitals of %j", (raw, _expected, before) => {
    expect(titleCaseName(raw)!.toLowerCase()).toBe(before.toLowerCase());
  });

  // The profile and household forms run the rule on blur and again on save.
  it.each(NAMES)("leaves the result for %j alone on a second pass", (raw) => {
    const once = titleCaseName(raw)!;
    expect(titleCaseName(once)).toBe(once);
  });

  it("treats an empty or blank name as none", () => {
    expect(titleCaseName("")).toBeNull();
    expect(titleCaseName("   ")).toBeNull();
  });
});

describe("titleCaseStreet", () => {
  it.each([
    ["123 mack ave", "123 Mack Ave"],
    ["45 MacArthur blvd", "45 MacArthur Blvd"],
    ["9 dekalb st ne", "9 Dekalb St NE"],
    ["3RD st", "3rd St"],
  ])("turns %j into %j", (raw, expected) => {
    expect(titleCaseStreet(raw)).toBe(expected);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail(" Name@Example.COM ")).toBe("name@example.com");
  });

  it("treats an empty address as none", () => {
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("  ")).toBeNull();
  });
});
