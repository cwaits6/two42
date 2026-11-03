import { describe, expect, it } from "vitest";
import {
  PRAYER_RETENTION_OPTIONS,
  isPrayerRetentionMonths,
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
