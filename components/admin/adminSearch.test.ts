import { describe, expect, it } from "vitest";
import { matchesSearch } from "./adminSearch";

describe("matchesSearch", () => {
  it("matches everything on a blank query", () => {
    expect(matchesSearch("   ", ["Ada Lovelace"])).toBe(true);
  });

  it("ignores case and accents", () => {
    expect(matchesSearch("PEREZ", ["Ana Pérez"])).toBe(true);
    expect(matchesSearch("pérez", ["Ana Perez"])).toBe(true);
  });

  it("lets each word match a different field, and needs every word to match", () => {
    expect(matchesSearch("ada example", ["Ada Lovelace", "ada@example.test"])).toBe(true);
    expect(matchesSearch("ada okafor", ["Ada Lovelace", "ada@example.test"])).toBe(false);
  });

  it("skips empty fields", () => {
    expect(matchesSearch("ada", [null, undefined, ""])).toBe(false);
  });
});
