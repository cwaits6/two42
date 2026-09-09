// Unit test for the platform organization detail page's pure timestamp
// formatter. Mirrors the app/admin/settings/email/page.test.ts convention
// of testing exported pure helpers directly rather than adopting
// component-level (RTL) tests, which this repo doesn't otherwise use.

import { describe, expect, it } from "vitest";
import { formatUtcTimestamp } from "@/app/platform/organizations/[id]/OrganizationDetail";

describe("formatUtcTimestamp", () => {
  it("formats in UTC regardless of the local time zone", () => {
    // 2026-01-15T23:30:00Z is still Jan 15 in UTC no matter where the test
    // runs — pinning the explicit timeZone: "UTC" option this function
    // exists to guarantee (a bare toLocaleString() would drift by locale).
    expect(formatUtcTimestamp("2026-01-15T23:30:00Z")).toBe(
      "January 15, 2026 at 11:30 PM UTC",
    );
  });
});
