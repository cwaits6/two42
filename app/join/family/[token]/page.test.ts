// Unit tests for the family-invite page's pure link builder. The page itself
// is not rendered here; only the helper that turns an invite row into a
// path-anchored join link is exercised.

import { describe, expect, it } from "vitest";

const { buildFamilyInviteJoinUrl } = await import("./page");

describe("buildFamilyInviteJoinUrl", () => {
  it("names the invite's org as a path segment", () => {
    expect(buildFamilyInviteJoinUrl("grace", "abc-123", "a@b.com")).toBe(
      "/grace/join?invite_token=abc-123&email=a%40b.com",
    );
  });

  it("encodes special characters in the token and email", () => {
    expect(buildFamilyInviteJoinUrl("grace", "a b", "a+b@c.com")).toBe(
      "/grace/join?invite_token=a%20b&email=a%2Bb%40c.com",
    );
  });

  it("encodes query-delimiter characters in the email", () => {
    expect(buildFamilyInviteJoinUrl("grace", "abc-123", "a&b=c@d.com")).toBe(
      "/grace/join?invite_token=abc-123&email=a%26b%3Dc%40d.com",
    );
  });
});
