import { describe, expect, it } from "vitest";
import { compare, normalizeName, suggest, type ProfileForMatch } from "./match";
import type { RecordsPerson } from "./types";

function person(over: Partial<RecordsPerson> = {}): RecordsPerson {
  return {
    id: "100",
    firstName: "Margaret",
    nickName: "Peggy",
    lastName: "O'Brien",
    email: "obriens@example.org",
    birthMonth: 4,
    birthDay: 12,
    birthYear: 1961,
    linkable: true,
    ...over,
  };
}

function profile(over: Partial<ProfileForMatch> = {}): ProfileForMatch {
  return {
    id: "p1",
    firstName: "Margaret",
    preferredName: null,
    lastName: "OBrien",
    email: "obriens@example.org",
    birthMonth: 4,
    birthDay: 12,
    birthYear: null,
    ...over,
  };
}

describe("normalizeName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(normalizeName("José O'Brien-Smith")).toBe(normalizeName("jose obriensmith"));
  });
});

describe("compare", () => {
  it("matches on name, email and birthday month and day", () => {
    expect(compare(profile(), person())).toEqual({ email: true, birthday: true });
  });

  it("matches a preferred name against the records' nick name", () => {
    expect(compare(profile({ firstName: "Mags", preferredName: "Peggy" }), person())).not.toBeNull();
  });

  it("never matches on email alone, as a spouse sharing the address would", () => {
    expect(compare(profile({ firstName: "Thomas" }), person())).toBeNull();
  });

  it("rules out a birthday or birth year that disagrees", () => {
    expect(compare(profile({ birthDay: 13 }), person())).toBeNull();
    expect(compare(profile({ birthYear: 1962 }), person())).toBeNull();
  });

  it("treats a missing birthday on either side as no evidence, not a mismatch", () => {
    expect(compare(profile({ birthMonth: null, birthDay: null }), person())).toEqual({ email: true, birthday: false });
  });
});

describe("suggest", () => {
  it("lets a unique match with more than the name be confirmed in bulk", () => {
    const [s] = suggest([profile()], [person()], new Set());
    expect(s).toMatchObject({ profileId: "p1", personId: "100", personName: "Peggy O'Brien", confirmableInBulk: true });
  });

  it("keeps a name-only match out of bulk", () => {
    const [s] = suggest([profile({ email: null, birthMonth: null, birthDay: null })], [person()], new Set());
    expect(s.confirmableInBulk).toBe(false);
  });

  it("keeps out of bulk a profile with two candidates, and a person two profiles could be", () => {
    const twoPeople = suggest([profile()], [person(), person({ id: "101" })], new Set());
    expect(twoPeople.every((s) => !s.confirmableInBulk)).toBe(true);
    const twoProfiles = suggest([profile(), profile({ id: "p2" })], [person()], new Set());
    expect(twoProfiles.every((s) => !s.confirmableInBulk)).toBe(true);
  });

  it("never suggests a person already linked or not linkable", () => {
    expect(suggest([profile()], [person()], new Set(["100"]))).toEqual([]);
    expect(suggest([profile()], [person({ linkable: false })], new Set())).toEqual([]);
  });
});
