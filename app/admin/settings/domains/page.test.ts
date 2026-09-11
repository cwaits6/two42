// Unit tests for the admin custom-domains page's pure helpers.
// Mirrors app/admin/settings/email/page.test.ts's pattern for the same
// shape of function on this page's stated sibling.

import { describe, expect, it } from "vitest";
import { looksLikeApex, statusLabel, statusVariant } from "@/app/admin/settings/domains/page";

describe("looksLikeApex", () => {
  it.each(["example.church", "two42.io", "example.co.uk", "example.com.au"])("treats %s as an apex", (d) =>
    expect(looksLikeApex(d)).toBe(true),
  );
  it.each(["www.example.church", "a.b.example.church", "www.example.co.uk", "a.b.example.co.uk"])(
    "treats %s as not an apex",
    (d) =>
    expect(looksLikeApex(d)).toBe(false),
  );
});

describe("statusVariant", () => {
  it("maps verified to default", () => {
    expect(statusVariant("verified")).toBe("default");
  });
  it("maps pending to secondary", () => {
    expect(statusVariant("pending")).toBe("secondary");
  });
  it("maps removing to outline", () => {
    expect(statusVariant("removing")).toBe("outline");
  });
  it("falls back to destructive for an unrecognized status rather than throwing", () => {
    expect(statusVariant("made_up_future_status" as never)).toBe("destructive");
  });
});

describe("statusLabel", () => {
  it("reports Live only once attached_at is set on a verified row", () => {
    expect(statusLabel({ status: "verified", attached_at: null })).toBe(
      "Verified, awaiting activation",
    );
    expect(statusLabel({ status: "verified", attached_at: "2026-09-01T00:00:00Z" })).toBe("Live");
  });
  it("labels removing and failed distinctly", () => {
    expect(statusLabel({ status: "removing", attached_at: null })).toBe("Removing");
    expect(statusLabel({ status: "failed", attached_at: null })).toBe("Check failed");
  });
  it("falls back to Pending verification for an unrecognized status", () => {
    expect(statusLabel({ status: "made_up_future_status" as never, attached_at: null })).toBe(
      "Pending verification",
    );
  });
});
