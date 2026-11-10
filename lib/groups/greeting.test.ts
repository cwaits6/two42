import { describe, expect, it } from "vitest";
import { greeting, greetingName, todayLabel } from "./greeting";

const ZONE = "America/New_York";

describe("greeting", () => {
  it.each([
    ["2026-11-02T13:00:00Z", "Good morning"],
    ["2026-11-02T18:00:00Z", "Good afternoon"],
    ["2026-11-02T23:00:00Z", "Good evening"],
  ])("reads %s on the org's clock as %s", (iso, expected) => {
    expect(greeting(ZONE, new Date(iso))).toBe(expected);
  });
});

describe("todayLabel", () => {
  it("writes the date out in the org's zone", () => {
    expect(todayLabel(ZONE, new Date("2026-11-02T03:00:00Z"))).toBe("Sunday, November 1");
  });
});

describe("greetingName", () => {
  it("has no name when the profile failed to load", () => {
    expect(greetingName(null)).toBeNull();
  });

  it("uses the email greeting's rule for a loaded profile", () => {
    expect(greetingName({ preferred_name: " ", first_name: "Ann" })).toBe("Ann");
  });
});
