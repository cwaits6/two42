import { describe, expect, it } from "vitest";
import type { FamilyDirectoryFull } from "@/lib/types";
import { hasPeopleToShow, nameableSpouse, searchablePeople } from "./householdPeople";

const henry = { id: "henry", first_name: "Henry", relationship: "primary" };
const chloeRecord = { id: "fm-chloe", first_name: "Chloe", relationship: "spouse", claimed_profile_id: "chloe" };
const kid = { id: "fm-kid", first_name: "Max", relationship: "child", claimed_profile_id: null };

const household = (members: object[], list: object[]) =>
  ({ id: "h", family_name: "Mockingham", members, family_members_list: list }) as unknown as FamilyDirectoryFull;

describe("a household whose claimed spouse is hidden from the directory", () => {
  const family = household([henry], [chloeRecord]);

  it("names no spouse", () => {
    expect(nameableSpouse(family)).toBeUndefined();
  });

  it("can't be found by the hidden spouse's name", () => {
    expect(searchablePeople(family).map((p) => p.first_name)).toEqual(["Henry"]);
  });
});

describe("a household whose claimed spouse is visible", () => {
  it("names the spouse", () => {
    const chloe = { id: "chloe", first_name: "Chloe", relationship: "spouse" };
    expect(nameableSpouse(household([henry, chloe], [chloeRecord]))?.first_name).toBe("Chloe");
  });
});

describe("hasPeopleToShow", () => {
  it("is false when every person is hidden", () => {
    expect(hasPeopleToShow(household([], [chloeRecord]))).toBe(false);
    expect(hasPeopleToShow(household([], []))).toBe(false);
  });

  it("is true for a visible profile or someone without an account", () => {
    expect(hasPeopleToShow(household([henry], []))).toBe(true);
    expect(hasPeopleToShow(household([], [kid]))).toBe(true);
  });
});
