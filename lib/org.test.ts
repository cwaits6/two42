import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyHost,
  isReservedOrgSlug,
  isTrustedFallbackHost,
  isValidOrgSlug,
  normalizeHost,
  RESERVED_ORG_SLUGS,
} from "@/lib/org";

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

  it("accepts a slug that merely contains a reserved word as a substring", () => {
    // isReservedOrgSlug is an exact Set lookup, not substring matching — an
    // org named "grace-app-campus" or "team-admin" must not be blocked.
    expect(isReservedOrgSlug("grace-app-campus")).toBe(false);
    expect(isReservedOrgSlug("team-admin")).toBe(false);
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

describe("normalizeHost", () => {
  it("lowercases", () => {
    expect(normalizeHost("Grace.Two42.IO")).toBe("grace.two42.io");
  });

  it("strips a trailing dot", () => {
    expect(normalizeHost("grace.two42.io.")).toBe("grace.two42.io");
  });

  it("strips a port", () => {
    expect(normalizeHost("localhost:3000")).toBe("localhost");
  });

  it("handles all three at once", () => {
    expect(normalizeHost(" Grace.Two42.IO.:443 ")).toBe("grace.two42.io");
  });
});

describe("classifyHost", () => {
  const apex = "two42.io";

  it("classifies the apex itself", () => {
    expect(classifyHost("two42.io", apex)).toEqual({ kind: "apex" });
  });

  it("classifies a valid single-label subdomain", () => {
    expect(classifyHost("grace.two42.io", apex)).toEqual({
      kind: "subdomain",
      slug: "grace",
    });
  });

  it("rejects a reserved label", () => {
    expect(classifyHost("admin.two42.io", apex)).toEqual({
      kind: "invalid-subdomain",
    });
  });

  it("rejects a multi-label prefix instead of silently truncating it", () => {
    expect(classifyHost("a.b.two42.io", apex)).toEqual({
      kind: "invalid-subdomain",
    });
  });

  it("rejects a slug-invalid label", () => {
    // Single char fails the DB's minimum-two-characters rule (TN003).
    expect(classifyHost("x.two42.io", apex)).toEqual({
      kind: "invalid-subdomain",
    });
  });

  it("never classifies a host that merely ends with the apex string as platform", () => {
    // Security-critical: no dot boundary before the apex, so a registrable
    // name like evil-two42.io must fall to the custom-domain path (where
    // only a verified org_domains row could ever resolve it).
    expect(classifyHost("evil-two42.io", apex)).toEqual({
      kind: "custom-domain-candidate",
    });
  });

  it("classifies an unrelated host as a custom-domain candidate", () => {
    expect(classifyHost("smallgroup.example.church", apex)).toEqual({
      kind: "custom-domain-candidate",
    });
  });
});

describe("isTrustedFallbackHost", () => {
  const siteUrl = "http://localhost:3000";

  it("trusts localhost and 127.0.0.1", () => {
    expect(isTrustedFallbackHost("localhost", { siteUrl })).toBe(true);
    expect(isTrustedFallbackHost("127.0.0.1", { siteUrl })).toBe(true);
  });

  it("trusts vercel preview hosts", () => {
    expect(
      isTrustedFallbackHost("my-app-git-main.vercel.app", { siteUrl })
    ).toBe(true);
  });

  it("trusts the deployment's own NEXT_PUBLIC_SITE_URL host", () => {
    expect(
      isTrustedFallbackHost("incouragers.org", {
        siteUrl: "https://incouragers.org",
      })
    ).toBe(true);
  });

  it("does not trust an unrelated host", () => {
    expect(isTrustedFallbackHost("evil.example", { siteUrl })).toBe(false);
  });

  it("does not throw on a malformed siteUrl", () => {
    expect(
      isTrustedFallbackHost("evil.example", { siteUrl: "not a url" })
    ).toBe(false);
  });
});

describe("RESERVED_ORG_SLUGS parity with the TN006 migration", () => {
  it("matches the SQL denylist in supabase/migrations/20260818000000_reserved_org_slugs.sql exactly", () => {
    const migrationPath = fileURLToPath(
      new URL(
        "../supabase/migrations/20260818000000_reserved_org_slugs.sql",
        import.meta.url
      )
    );
    const sql = readFileSync(migrationPath, "utf8");
    const match = sql.match(/_slug = any\(array\[([\s\S]*?)\]\)/);
    if (!match) {
      throw new Error(
        "could not find the reserved-slug array literal in the TN006 migration — " +
          "update this test's regex if the migration's syntax changed"
      );
    }
    const sqlSlugs = new Set(
      match[1]
        .split(",")
        .map((entry) => entry.trim().replace(/^'|'$/g, ""))
        .filter(Boolean)
    );
    expect(sqlSlugs).toEqual(new Set(RESERVED_ORG_SLUGS));
  });
});
