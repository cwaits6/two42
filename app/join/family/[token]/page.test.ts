// Unit tests for the family-invite page's pure link builder. The page itself
// is not rendered here; only the helper that turns an invite row into an
// absolute, org-anchored join link is exercised.

import { beforeEach, describe, expect, it, vi } from "vitest";

const orgBaseUrl = vi.fn();
vi.mock("@/lib/org-urls", () => ({ orgBaseUrl: (orgId: string) => orgBaseUrl(orgId) }));

const { buildFamilyInviteJoinUrl } = await import("./page");

beforeEach(() => {
  orgBaseUrl.mockReset();
});

describe("buildFamilyInviteJoinUrl", () => {
  it("builds a join link anchored to the invite org's own origin", async () => {
    orgBaseUrl.mockResolvedValue("https://grace.two42.io");

    await expect(
      buildFamilyInviteJoinUrl("org-1", "grace", "abc-123", "a@b.com"),
    ).resolves.toBe(
      "https://grace.two42.io/grace/join?invite_token=abc-123&email=a%40b.com",
    );
    expect(orgBaseUrl).toHaveBeenCalledWith("org-1");
  });

  it("encodes special characters in the token and email", async () => {
    orgBaseUrl.mockResolvedValue("https://grace.two42.io");

    await expect(
      buildFamilyInviteJoinUrl("org-1", "grace", "a b", "a+b@c.com"),
    ).resolves.toBe(
      "https://grace.two42.io/grace/join?invite_token=a%20b&email=a%2Bb%40c.com",
    );
  });

  it("encodes query-delimiter characters in the email", async () => {
    orgBaseUrl.mockResolvedValue("https://grace.two42.io");

    await expect(
      buildFamilyInviteJoinUrl("org-1", "grace", "abc-123", "a&b=c@d.com"),
    ).resolves.toBe(
      "https://grace.two42.io/grace/join?invite_token=abc-123&email=a%26b%3Dc%40d.com",
    );
  });

  it("uses whatever origin orgBaseUrl resolves, even when it falls back off the invite's own host", async () => {
    orgBaseUrl.mockResolvedValue("https://two42.io");

    await expect(
      buildFamilyInviteJoinUrl("org-1", "grace", "abc-123", "a@b.com"),
    ).resolves.toBe("https://two42.io/grace/join?invite_token=abc-123&email=a%40b.com");
  });
});
