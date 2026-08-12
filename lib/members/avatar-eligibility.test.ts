// Unit tests for the admin avatar-write eligibility gate (CWA-62 / #337).
// Every branch here is a security decision, and the fail-closed ones (null
// family_id, non-leader relationship) are what a refactor is most likely to
// invert — reopening the "Failed to upload photo" bug this predicate exists
// to prevent, in a narrower form each time.

import { describe, expect, it } from "vitest";
import { canManageAvatar } from "@/lib/members/avatar-eligibility";

describe("canManageAvatar", () => {
  it("allows the caller to manage their own avatar", () => {
    expect(
      canManageAvatar(
        { id: "u1", family_id: null, relationship: null },
        { id: "u1", family_id: null }
      )
    ).toBe(true);
  });

  it("allows a household leader (primary) to manage another member's avatar", () => {
    expect(
      canManageAvatar(
        { id: "u1", family_id: "fam-1", relationship: "primary" },
        { id: "u2", family_id: "fam-1" }
      )
    ).toBe(true);
  });

  it("allows a household leader (spouse) to manage another member's avatar", () => {
    expect(
      canManageAvatar(
        { id: "u1", family_id: "fam-1", relationship: "spouse" },
        { id: "u2", family_id: "fam-1" }
      )
    ).toBe(true);
  });

  it("denies a non-leader member of the same household — matches storage RLS", () => {
    // The exact narrower bug the HIGH review finding called out: family_id
    // equality alone is not the storage policy's requirement.
    expect(
      canManageAvatar(
        { id: "u1", family_id: "fam-1", relationship: "child" },
        { id: "u2", family_id: "fam-1" }
      )
    ).toBe(false);
  });

  it("denies an admin with no shared household and no matching id", () => {
    expect(
      canManageAvatar(
        { id: "u1", family_id: "fam-1", relationship: "primary" },
        { id: "u2", family_id: "fam-2" }
      )
    ).toBe(false);
  });

  it("denies when both caller and target have a null family_id (not the same household)", () => {
    expect(
      canManageAvatar(
        { id: "u1", family_id: null, relationship: "primary" },
        { id: "u2", family_id: null }
      )
    ).toBe(false);
  });
});
