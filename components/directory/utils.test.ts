import { describe, expect, it } from "vitest";
import { formatAnniversary, householdPhoneLabel, showsHouseholdPhone } from "./utils";
import type { FamilyDirectoryFull } from "@/lib/types";

const members = [
  { id: "chloe", first_name: "Chloe", preferred_name: null },
  { id: "henry", first_name: "Henry", preferred_name: "Hank" },
] as FamilyDirectoryFull["members"];

describe("formatAnniversary", () => {
  it("shows the year only when there is one", () => {
    expect(formatAnniversary(10, 3, 2009)).toBe("October 3, 2009");
    expect(formatAnniversary(10, 3, null)).toBe("October 3");
  });
});

describe("householdPhoneLabel", () => {
  it("calls a shared number the home phone", () => {
    expect(householdPhoneLabel({ phone_profile_id: null, members })).toBe("home");
  });

  it("names the spouse whose number it is, by the name they go by", () => {
    expect(householdPhoneLabel({ phone_profile_id: "chloe", members })).toBe("Chloe's mobile");
    expect(householdPhoneLabel({ phone_profile_id: "henry", members })).toBe("Hank's mobile");
  });
});

describe("showsHouseholdPhone", () => {
  const person = (phone_home: string | null) => ({ id: "me", phone_home });

  it("shows a shared number only to someone with no home phone of their own", () => {
    expect(showsHouseholdPhone(person(null), { phone_profile_id: null })).toBe(true);
    expect(showsHouseholdPhone(person("+15125550100"), { phone_profile_id: null })).toBe(false);
  });

  it("shows a spouse's number beside this person's own home phone", () => {
    expect(showsHouseholdPhone(person("+15125550100"), { phone_profile_id: "spouse" })).toBe(true);
  });

  it("leaves out this person's own number, which is their mobile line", () => {
    expect(showsHouseholdPhone(person(null), { phone_profile_id: "me" })).toBe(false);
  });
});
