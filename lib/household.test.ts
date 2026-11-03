import { describe, expect, it } from "vitest";
import { isChildWithoutAccount } from "@/lib/household";

describe("isChildWithoutAccount", () => {
  it("is a person listed as a child with no account of their own", () => {
    expect(isChildWithoutAccount({ relationship: "child", claimed_profile_id: null })).toBe(true);
    expect(isChildWithoutAccount({ relationship: "child" })).toBe(true);
  });

  it("isn't a child with an account", () => {
    expect(isChildWithoutAccount({ relationship: "child", claimed_profile_id: "p1" })).toBe(false);
  });

  it("isn't anyone else", () => {
    for (const relationship of ["primary", "spouse", "parent", "sibling", "other", null]) {
      expect(isChildWithoutAccount({ relationship, claimed_profile_id: null })).toBe(false);
    }
  });
});
