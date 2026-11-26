import { describe, expect, it } from "vitest";
import { dinnerOpen } from "./labels";

const NOW = new Date("2027-03-01T12:00:00Z");

describe("dinnerOpen", () => {
  it("is open for a running season's dinner still to come", () => {
    expect(dinnerOpen("published", "2027-03-02T00:00:00Z", NOW)).toBe(true);
  });

  it("is closed once the dinner has started", () => {
    expect(dinnerOpen("published", "2027-03-01T12:00:00Z", NOW)).toBe(false);
  });

  it("is closed for every dinner of an ended season, so it shows no reply prompts", () => {
    expect(dinnerOpen("ended", "2027-03-02T00:00:00Z", NOW)).toBe(false);
  });
});
