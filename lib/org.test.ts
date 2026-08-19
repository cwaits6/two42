import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
