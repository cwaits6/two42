import { describe, expect, it } from "vitest";
import { displayName, formalName, hasName, initials, titledName } from "@/lib/names";

const bill = { first_name: "William", last_name: "Marble", preferred_name: "Bill" };

describe("displayName", () => {
  it("puts the suffix after the name", () => {
    expect(displayName({ ...bill, suffix: "Jr." })).toBe("Bill Marble Jr.");
  });

  it("trims the suffix and leaves out a blank one", () => {
    expect(displayName({ ...bill, suffix: "  III " })).toBe("Bill Marble III");
    expect(displayName({ ...bill, suffix: "  " })).toBe("Bill Marble");
    expect(displayName({ ...bill, suffix: null })).toBe("Bill Marble");
    expect(displayName(bill)).toBe("Bill Marble");
  });

  it("shows a suffix after a first name alone", () => {
    expect(displayName({ first_name: "Bill", last_name: null, suffix: "Sr." })).toBe("Bill Sr.");
  });

  it("treats a suffix with no name as unnamed", () => {
    const p = { first_name: null, last_name: null, suffix: "Jr." };
    expect(displayName(p)).toBe("(unnamed)");
    expect(hasName(p)).toBe(false);
  });
});

describe("formalName", () => {
  it("uses the first name and the suffix", () => {
    expect(formalName({ ...bill, suffix: "Jr." })).toBe("William Marble Jr.");
  });
});

describe("titledName", () => {
  it("puts the title before the name", () => {
    expect(titledName({ ...bill, suffix: "Jr.", title: "Dr." })).toBe("Dr. Bill Marble Jr.");
  });

  it("is the display name without a title", () => {
    expect(titledName({ ...bill, title: " " })).toBe("Bill Marble");
    expect(titledName(bill)).toBe("Bill Marble");
  });

  it("never shows a title on its own", () => {
    expect(titledName({ first_name: null, last_name: null, title: "Pastor" })).toBe("(unnamed)");
    expect(titledName(null)).toBe("(unnamed)");
  });
});

describe("initials", () => {
  it("ignores the suffix", () => {
    expect(initials({ ...bill, suffix: "Jr." })).toBe("BM");
  });
});
