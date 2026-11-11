import { describe, expect, it } from "vitest";
import { normalizeEmail, titleCaseName } from "@/lib/sanitize";

describe("titleCaseName", () => {
  it.each([
    ["john MCDONALD", "John McDonald"],
    ["JOHN SMITH", "John Smith"],
    ["mARY o'brien", "Mary O'Brien"],
    ["jean-luc PICARD", "Jean-Luc Picard"],
    ["ana VAN DER berg", "Ana van der Berg"],
    ["  john   smith ", "John Smith"],
  ])("turns %j into %j", (raw, expected) => {
    expect(titleCaseName(raw)).toBe(expected);
  });

  it("treats an empty or blank name as none", () => {
    expect(titleCaseName("")).toBeNull();
    expect(titleCaseName("   ")).toBeNull();
  });

  // Forms check a name's length after title-casing it, and the server title-cases
  // what they send before checking again; the two verdicts agree only if a second
  // pass keeps the length.
  it.each(["ßmith", "ﬁnn o'ﬂaherty", "john MCDONALD", "ǆenan"])(
    "keeps the length of %j on a second pass",
    (raw) => {
      const once = titleCaseName(raw)!;
      expect(titleCaseName(once)!.length).toBe(once.length);
    },
  );
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
