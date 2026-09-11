// Unit tests for the platform-wide domain-cap env parsing. The branches
// worth pinning: a malformed ORG_EMAIL_DOMAIN_CAP must fall back to the
// documented default (never leak NaN into the >= comparison in
// app/api/admin/email-domain/route.ts, which would silently disable the
// cap), and 0 is a deliberately valid value (a kill switch), not treated as
// "unset".

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORG_EMAIL_DOMAIN_CAP,
  getOrgEmailDomainCap,
} from "@/lib/email/domainCap";

afterEach(() => {
  delete process.env.ORG_EMAIL_DOMAIN_CAP;
  vi.restoreAllMocks();
});

describe("getOrgEmailDomainCap", () => {
  it("defaults when unset", () => {
    delete process.env.ORG_EMAIL_DOMAIN_CAP;
    expect(getOrgEmailDomainCap()).toBe(DEFAULT_ORG_EMAIL_DOMAIN_CAP);
  });

  it("defaults (without logging) for an empty string", () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getOrgEmailDomainCap()).toBe(DEFAULT_ORG_EMAIL_DOMAIN_CAP);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns a valid override", () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "3";
    expect(getOrgEmailDomainCap()).toBe(3);
  });

  it.each(["abc", "3.5", "-1", "NaN", "Infinity"])(
    "falls back to the default and logs for %s",
    (raw) => {
      process.env.ORG_EMAIL_DOMAIN_CAP = raw;
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(getOrgEmailDomainCap()).toBe(DEFAULT_ORG_EMAIL_DOMAIN_CAP);
      expect(console.error).toHaveBeenCalled();
    },
  );

  it("accepts 0 as an explicit kill switch, not as unset", () => {
    process.env.ORG_EMAIL_DOMAIN_CAP = "0";
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getOrgEmailDomainCap()).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });
});
