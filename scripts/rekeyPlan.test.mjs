import { describe, expect, it } from "vitest";
import { classifyObject, isOrgPartitioned } from "./rekeyPlan.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const PROFILE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FAMILY = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const MEMBER = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";

describe("isOrgPartitioned", () => {
  it("accepts the org-partitioned layout", () => {
    expect(isOrgPartitioned(`${ORG}/profiles/${PROFILE}/avatar.jpg`.split("/"))).toBe(true);
    expect(isOrgPartitioned(`${ORG}/families/${FAMILY}/photo.jpg`.split("/"))).toBe(true);
  });

  // The bug this module exists to prevent: the legacy profile-avatar key also
  // starts with a UUID, so "first segment is a UUID" classified every member
  // avatar as already done.
  it("rejects the legacy profile-avatar key, whose first segment is also a UUID", () => {
    expect(isOrgPartitioned(`${PROFILE}/avatar.jpg`.split("/"))).toBe(false);
  });

  it("rejects a UUID prefix followed by an unknown kind", () => {
    expect(isOrgPartitioned(`${ORG}/bogus/${PROFILE}/avatar.jpg`.split("/"))).toBe(false);
  });

  it("rejects the other legacy shapes", () => {
    expect(isOrgPartitioned(`families/${FAMILY}/photo.jpg`.split("/"))).toBe(false);
    expect(isOrgPartitioned(`family-members/${MEMBER}/avatar.jpg`.split("/"))).toBe(false);
  });
});

describe("classifyObject", () => {
  it("re-keys a legacy profile avatar into <org>/profiles/<profile>/", () => {
    const plan = classifyObject("avatars", `${PROFILE}/avatar.jpg`, ORG);
    expect(plan.action).toBe("rekey");
    expect(plan.newName).toBe(`${ORG}/profiles/${PROFILE}/avatar.jpg`);
    expect(plan.entityId).toBe(PROFILE);
    expect(plan.shape.urlTable).toBe("profiles");
    expect(plan.shape.urlColumn).toBe("avatar_url");
  });

  it("re-keys a legacy family photo", () => {
    const plan = classifyObject("avatars", `families/${FAMILY}/photo.jpg`, ORG);
    expect(plan.action).toBe("rekey");
    expect(plan.newName).toBe(`${ORG}/families/${FAMILY}/photo.jpg`);
    expect(plan.entityId).toBe(FAMILY);
    expect(plan.shape.urlTable).toBe("family_units");
    expect(plan.shape.urlColumn).toBe("photo_url");
  });

  it("re-keys a legacy family-member avatar", () => {
    const plan = classifyObject("avatars", `family-members/${MEMBER}/avatar.jpg`, ORG);
    expect(plan.action).toBe("rekey");
    expect(plan.newName).toBe(`${ORG}/family-members/${MEMBER}/avatar.jpg`);
    expect(plan.entityId).toBe(MEMBER);
    expect(plan.shape.urlTable).toBe("family_members");
    expect(plan.shape.urlColumn).toBe("avatar_url");
  });

  it("skips an already-partitioned key (idempotency)", () => {
    const plan = classifyObject("avatars", `${ORG}/profiles/${PROFILE}/avatar.jpg`, ORG);
    expect(plan).toEqual({ action: "skip", reason: "already-prefixed" });
  });

  it("distinguishes another org's prefix from this run's", () => {
    const plan = classifyObject("avatars", `${OTHER_ORG}/profiles/${PROFILE}/avatar.jpg`, ORG);
    expect(plan).toEqual({ action: "skip", reason: "other-org" });
  });

  it("re-keying is idempotent: its own output classifies as skipped", () => {
    const first = classifyObject("avatars", `${PROFILE}/avatar.jpg`, ORG);
    const second = classifyObject("avatars", first.newName, ORG);
    expect(second).toEqual({ action: "skip", reason: "already-prefixed" });
  });

  it("does not match an avatars shape against the event-images bucket", () => {
    expect(classifyObject("event-images", `families/${FAMILY}/photo.jpg`, ORG)).toEqual({
      action: "unrecognized",
    });
  });

  it("reports an unknown shape as unrecognized rather than guessing", () => {
    expect(classifyObject("avatars", "stray.jpg", ORG)).toEqual({ action: "unrecognized" });
    expect(classifyObject("avatars", "misc/a/b/c/d.jpg", ORG)).toEqual({
      action: "unrecognized",
    });
  });
});
