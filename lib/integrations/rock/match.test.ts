import { describe, expect, it } from "vitest";
import type { RockPerson } from "./client";
import { compare, linkable, normalizeName, suggest, type ProfileForMatch } from "./match";

const ids = { recordTypePerson: 1, recordStatusInactive: 4 };

function person(over: Partial<RockPerson> = {}): RockPerson {
  return {
    id: 100,
    firstName: "Margaret",
    nickName: "Peggy",
    lastName: "O'Brien",
    email: "obriens@example.org",
    birthMonth: 4,
    birthDay: 12,
    birthYear: 1961,
    recordTypeValueId: 1,
    recordStatusValueId: 3,
    isDeceased: false,
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

  it("matches a preferred name against Rock's nick name", () => {
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

describe("linkable", () => {
  it("refuses businesses, the deceased and inactive records", () => {
    expect(linkable(person(), ids)).toBe(true);
    expect(linkable(person({ recordTypeValueId: 2 }), ids)).toBe(false);
    expect(linkable(person({ isDeceased: true }), ids)).toBe(false);
    expect(linkable(person({ recordStatusValueId: 4 }), ids)).toBe(false);
  });
});

describe("suggest", () => {
  it("lets a unique match with more than the name be confirmed in bulk", () => {
    const [s] = suggest([profile()], [person()], ids, new Set());
    expect(s).toMatchObject({ profileId: "p1", rockPersonId: 100, rockName: "Peggy O'Brien", confirmableInBulk: true });
  });

  it("keeps a name-only match out of bulk", () => {
    const [s] = suggest([profile({ email: null, birthMonth: null, birthDay: null })], [person()], ids, new Set());
    expect(s.confirmableInBulk).toBe(false);
  });

  it("keeps out of bulk a profile with two candidates, and a person two profiles could be", () => {
    const twoPeople = suggest([profile()], [person(), person({ id: 101 })], ids, new Set());
    expect(twoPeople.every((s) => !s.confirmableInBulk)).toBe(true);
    const twoProfiles = suggest([profile(), profile({ id: "p2" })], [person()], ids, new Set());
    expect(twoProfiles.every((s) => !s.confirmableInBulk)).toBe(true);
  });

  it("never suggests a Rock person already linked or not linkable", () => {
    expect(suggest([profile()], [person()], ids, new Set([100]))).toEqual([]);
    expect(suggest([profile()], [person({ isDeceased: true })], ids, new Set())).toEqual([]);
  });
});
