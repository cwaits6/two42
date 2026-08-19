// Unit tests for the admin email-settings page's pure helpers (CWA-70).
// toDnsRecords is the boundary between an untyped `Json` DB column
// (ultimately sourced from Resend's API) and rendered HTML — its own doc
// comment claims a shape change on Resend's side degrades to a partial row,
// never a crash; these tests pin that claim instead of leaving it asserted
// only in prose.

import { describe, expect, it } from "vitest";
import {
  statusLabel,
  statusVariant,
  toDnsRecords,
} from "@/app/admin/settings/email/page";

describe("toDnsRecords", () => {
  it("passes through well-formed records", () => {
    const records = [{ record: "DKIM", name: "resend._domainkey", value: "v=DKIM1" }];
    expect(toDnsRecords(records)).toEqual(records);
  });

  it("degrades to an empty array for non-array input", () => {
    expect(toDnsRecords(null)).toEqual([]);
    expect(toDnsRecords(undefined)).toEqual([]);
    expect(toDnsRecords("not an array")).toEqual([]);
    expect(toDnsRecords({ record: "DKIM" })).toEqual([]);
  });

  it("filters out non-object entries instead of throwing", () => {
    expect(toDnsRecords([{ record: "DKIM" }, null, "garbage", 42, { record: "SPF" }])).toEqual([
      { record: "DKIM" },
      { record: "SPF" },
    ]);
  });

  it("passes through an empty array unchanged", () => {
    expect(toDnsRecords([])).toEqual([]);
  });
});

describe("statusVariant", () => {
  it("maps verified to default", () => {
    expect(statusVariant("verified")).toBe("default");
  });

  it.each(["pending", "not_started", "partially_verified"])(
    "maps %s to secondary",
    (status) => expect(statusVariant(status)).toBe("secondary"),
  );

  it.each(["failure", "temporary_failure", "failed", "partially_failed"])(
    "maps %s to destructive",
    (status) => expect(statusVariant(status)).toBe("destructive"),
  );

  it("falls back to destructive for an unrecognized status rather than throwing", () => {
    // Deviation 1 widened the status vocabulary specifically to anticipate
    // Resend statuses this UI hasn't seen yet — the fallback is the point.
    expect(statusVariant("made_up_future_status")).toBe("destructive");
  });
});

describe("statusLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(statusLabel("not_started")).toBe("not started");
    expect(statusLabel("partially_verified")).toBe("partially verified");
  });

  it("leaves a status with no underscores unchanged", () => {
    expect(statusLabel("verified")).toBe("verified");
  });
});
