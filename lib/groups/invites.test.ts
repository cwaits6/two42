import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPIRY_PRESET,
  DEFAULT_USE_PRESET,
  expiresAtFromPreset,
  expiryLabel,
  inviteJoinErrorMessage,
  inviteStatus,
  inviteUrl,
  INVITE_INVALID_TEXT,
  INVITE_OTHER_ACCOUNT_TEXT,
  maxUsesFromPreset,
  parseExpiryPreset,
  parseUsePreset,
  usesLabel,
} from "@/lib/groups/invites";

const NOW = new Date("2026-10-24T12:00:00Z");
const PAST = "2026-10-24T11:59:59Z";
const FUTURE = "2026-11-24T12:00:00Z";
const live = { revoked_at: null, expires_at: null, max_uses: null };

describe("inviteStatus", () => {
  it("is active with no limits and no revocation", () => {
    expect(inviteStatus(live, 0, NOW)).toBe("active");
    expect(inviteStatus({ ...live, expires_at: FUTURE, max_uses: 5 }, 4, NOW)).toBe("active");
  });

  it("is expired once expires_at has passed, including at the exact instant", () => {
    expect(inviteStatus({ ...live, expires_at: PAST }, 0, NOW)).toBe("expired");
    expect(inviteStatus({ ...live, expires_at: NOW.toISOString() }, 0, NOW)).toBe("expired");
  });

  it("is used up once the use count reaches max_uses", () => {
    expect(inviteStatus({ ...live, max_uses: 1 }, 1, NOW)).toBe("used_up");
    expect(inviteStatus({ ...live, max_uses: 1 }, 0, NOW)).toBe("active");
  });

  it("ranks revoked over expired over used up", () => {
    const everything = { revoked_at: PAST, expires_at: PAST, max_uses: 1 };
    expect(inviteStatus(everything, 1, NOW)).toBe("revoked");
    expect(inviteStatus({ ...everything, revoked_at: null }, 1, NOW)).toBe("expired");
    expect(inviteStatus({ ...everything, revoked_at: null, expires_at: FUTURE }, 1, NOW)).toBe("used_up");
  });
});

describe("presets", () => {
  it("default to no expiry and no use limit", () => {
    expect(DEFAULT_EXPIRY_PRESET).toBe("never");
    expect(DEFAULT_USE_PRESET).toBe("unlimited");
    expect(expiresAtFromPreset("never", NOW)).toBeNull();
    expect(maxUsesFromPreset("unlimited")).toBeNull();
  });

  it("turn the day presets into a timestamp that many days out", () => {
    expect(expiresAtFromPreset("7d", NOW)).toBe("2026-10-31T12:00:00.000Z");
    expect(expiresAtFromPreset("30d", NOW)).toBe("2026-11-23T12:00:00.000Z");
  });

  it("turn the use presets into a cap", () => {
    expect(maxUsesFromPreset("1")).toBe(1);
    expect(maxUsesFromPreset("10")).toBe(10);
  });

  it("fall back to the defaults for anything unrecognised", () => {
    expect(parseExpiryPreset("forever")).toBe("never");
    expect(parseExpiryPreset("7d")).toBe("7d");
    expect(parseUsePreset(5)).toBe("unlimited");
    expect(parseUsePreset("10")).toBe("10");
  });
});

describe("labels", () => {
  it("builds the join URL on the given origin without doubling slashes", () => {
    expect(inviteUrl("https://two42.io", "abc")).toBe("https://two42.io/join/abc");
    expect(inviteUrl("https://two42.io/", "abc")).toBe("https://two42.io/join/abc");
  });

  it("describes uses against a cap or as a plain count", () => {
    expect(usesLabel(3, 10)).toBe("Used 3 of 10");
    expect(usesLabel(1, null)).toBe("Used 1 time");
    expect(usesLabel(0, null)).toBe("Used 0 times");
  });

  it("describes expiry in the given time zone", () => {
    expect(expiryLabel(null, "UTC")).toBe("Never expires");
    expect(expiryLabel("2026-11-24T03:00:00Z", "UTC")).toBe("Expires November 24, 2026");
    expect(expiryLabel("2026-11-24T03:00:00Z", "America/New_York")).toBe("Expires November 23, 2026");
  });

  it("maps the member-path error codes to copy and falls back generically", () => {
    expect(inviteJoinErrorMessage("GI001")).toBe(INVITE_INVALID_TEXT);
    expect(inviteJoinErrorMessage("GI006")).toBe(INVITE_OTHER_ACCOUNT_TEXT);
    expect(inviteJoinErrorMessage("GJ003")).toMatch(/try again/i);
    expect(inviteJoinErrorMessage(undefined)).toMatch(/try again/i);
  });
});
