// Unit tests for the family-invite page's pure link builder. The page itself
// is not rendered here; only the helper that turns an invite row's org slug
// into a path-based join link is exercised.

import { describe, expect, it } from "vitest";
import { buildFamilyInviteJoinUrl } from "@/app/join/family/[token]/page";

describe("buildFamilyInviteJoinUrl", () => {
  it("builds a path-scoped join link from the invite's org slug", () => {
    expect(buildFamilyInviteJoinUrl("grace", "abc-123", "a@b.com")).toBe(
      "/grace/join?invite_token=abc-123&email=a%40b.com",
    );
  });

  it("encodes special characters in the token and email", () => {
    expect(buildFamilyInviteJoinUrl("grace", "a b", "a+b@c.com")).toBe(
      "/grace/join?invite_token=a%20b&email=a%2Bb%40c.com",
    );
  });
});
