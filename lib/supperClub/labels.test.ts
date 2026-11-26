import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPER_LENGTHS, SUPPER_LENGTH_OPTIONS, supperEndsAt, supperLengthLabel, supperOpen } from "./labels";

const NOW = new Date("2027-03-01T12:00:00Z");

describe("supperOpen", () => {
  it("is open for a running rotation's supper still to come", () => {
    expect(supperOpen("published", "2027-03-02T00:00:00Z", NOW)).toBe(true);
  });

  it("is closed once the supper has started", () => {
    expect(supperOpen("published", "2027-03-01T12:00:00Z", NOW)).toBe(false);
  });

  it("is closed for every supper of an ended rotation, so it shows no reply prompts", () => {
    expect(supperOpen("ended", "2027-03-02T00:00:00Z", NOW)).toBe(false);
  });
});

describe("supper length", () => {
  it("offers 1½ to 4 hours in half hours, labelled as people say them", () => {
    expect(SUPPER_LENGTH_OPTIONS).toEqual([
      { value: "90", label: "1½ hours" },
      { value: "120", label: "2 hours" },
      { value: "150", label: "2½ hours" },
      { value: "180", label: "3 hours" },
      { value: "210", label: "3½ hours" },
      { value: "240", label: "4 hours" },
    ]);
    expect(supperLengthLabel(60)).toBe("1 hour");
  });

  it("offers exactly the lengths the suppers column accepts", () => {
    const migration = readFileSync("supabase/migrations/20261206000000_supper_length.sql", "utf8");
    const list = migration.match(/constraint suppers_length_minutes_allowed check \(\w+ in \(([\d, ]+)\)\)/)?.[1];
    expect(list?.split(",").map(Number)).toEqual([...SUPPER_LENGTHS]);
  });

  it("ends a supper at its start plus its length", () => {
    expect(supperEndsAt("2027-03-02T00:00:00.000Z", 150)).toBe("2027-03-02T02:30:00.000Z");
  });
});
