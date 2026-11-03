import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRAYER_RETENTION_MONTHS as JOB_MONTHS } from "@/supabase/functions/_shared/retention";
import {
  PRAYER_RETENTION_OPTIONS,
  PRAYER_RETENTION_PERIODS,
  isPrayerRetentionMonths,
  parsePrayerRetention,
  prayerRetentionConfirmation,
} from "./prayerRetention";

describe("prayerRetentionConfirmation", () => {
  it.each([
    [6, "6 months"],
    [12, "1 year"],
    [24, "2 years"],
  ] as const)("says what %i months deletes, and when, in plain words", (months, period) => {
    const { title, description, confirmLabel } = prayerRetentionConfirmation(months);
    expect(title).toContain(period);
    expect(confirmLabel).toBe(`Delete after ${period}`);
    expect(description).toContain(`Tonight, every prayer request in your church posted more than ${period} ago`);
    expect(description).toContain("permanently deleted");
    expect(description).toContain("prayer responses");
    expect(description).toContain("can't be brought back");
  });
});

describe("PRAYER_RETENTION_OPTIONS", () => {
  it("offers keeping them first, then the three periods", () => {
    expect(PRAYER_RETENTION_OPTIONS).toEqual([
      { value: "off", label: "Keep prayer requests" },
      { value: "6", label: "Delete after 6 months" },
      { value: "12", label: "Delete after 1 year" },
      { value: "24", label: "Delete after 2 years" },
    ]);
  });
});

describe("isPrayerRetentionMonths", () => {
  it("accepts only an offered period", () => {
    expect([6, 12, 24].every(isPrayerRetentionMonths)).toBe(true);
    expect([0, 7, "6", null, undefined].some(isPrayerRetentionMonths)).toBe(false);
  });
});

describe("parsePrayerRetention", () => {
  it("reads every option back to what it stands for", () => {
    expect(PRAYER_RETENTION_OPTIONS.map((option) => parsePrayerRetention(option.value))).toEqual([
      "off",
      6,
      12,
      24,
    ]);
  });

  it("treats anything else as off", () => {
    expect(["", "7", "Infinity"].map(parsePrayerRetention)).toEqual(["off", "off", "off"]);
  });
});

describe("the periods on each side of the build boundaries", () => {
  // A period the CHECK refuses fails the save; one the job doesn't know throws
  // and stops that church's prayer request cleanup every night.
  it("are the same in the app, the job and the column's CHECK", () => {
    const app = Object.keys(PRAYER_RETENTION_PERIODS).map(Number);
    const migration = readFileSync("supabase/migrations/20261114000000_expired_data_cleanup.sql", "utf8");
    const check = migration.match(/check \(prayer_request_retention_months in \(([^)]*)\)\)/);

    expect(check?.[1].split(",").map(Number)).toEqual(app);
    expect([...JOB_MONTHS]).toEqual(app);
  });
});
