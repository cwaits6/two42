import { describe, expect, it } from "vitest";
import { isReservedOrgSlug, isValidOrgSlug, RESERVED_ORG_SLUGS } from "@/lib/org";

describe("isReservedOrgSlug", () => {
  it("rejects every slug in the reserved list", () => {
    for (const slug of RESERVED_ORG_SLUGS) {
      expect(isReservedOrgSlug(slug)).toBe(true);
    }
  });

  it("rejects the platform hosts named in Phase 5 §4", () => {
    for (const slug of ["www", "app", "api", "admin", "platform"]) {
      expect(isReservedOrgSlug(slug)).toBe(true);
    }
  });

  it("accepts an ordinary slug", () => {
    expect(isReservedOrgSlug("grace-chapel")).toBe(false);
  });

  it("does not treat 'default' as reserved yet", () => {
    // 'default' is the slug of the one org that exists today; it is
    // deliberately excluded until that org is renamed or retired.
    expect(isReservedOrgSlug("default")).toBe(false);
  });

  it("every reserved slug is itself a valid slug shape", () => {
    // The denylist only targets strings the TN003 regex would otherwise
    // accept — an entry the regex already rejects would be dead weight.
    for (const slug of RESERVED_ORG_SLUGS) {
      expect(isValidOrgSlug(slug)).toBe(true);
    }
  });
});
