import { describe, expect, it } from "vitest";
import { formatAnniversary, householdPhoneLabel } from "./utils";
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
