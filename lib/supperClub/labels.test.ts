import { describe, expect, it } from "vitest";
import { supperOpen } from "./labels";

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
