import { describe, expect, it } from "vitest";
import { profileHouseholdHref } from "./profileTabs";

describe("profileHouseholdHref", () => {
  it("links to the Household tab on the profile", () => {
    expect(profileHouseholdHref()).toBe("/profile?tab=household");
  });
});
