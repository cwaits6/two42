import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isChildWithoutAccount } from "@/lib/household";

describe("isChildWithoutAccount", () => {
  it("is a person listed as a child with no account of their own", () => {
    expect(isChildWithoutAccount({ relationship: "child", claimed_profile_id: null })).toBe(true);
    expect(isChildWithoutAccount({ relationship: "child" })).toBe(true);
  });

  it("isn't a child with an account", () => {
    expect(isChildWithoutAccount({ relationship: "child", claimed_profile_id: "p1" })).toBe(false);
  });

  it("isn't anyone else", () => {
    for (const relationship of ["primary", "spouse", "parent", "sibling", "other", null]) {
      expect(isChildWithoutAccount({ relationship, claimed_profile_id: null })).toBe(false);
    }
  });
});

describe("isChildWithoutAccount and is_child_without_account()", () => {
  // The pgTAP suite asserts the SQL rule against these same rows.
  const suite = readFileSync("supabase/tests/household_rules_suite.sql", "utf8");
  const table = suite.split("-- child rule cases: begin")[1]?.split("-- child rule cases: end")[0] ?? "";
  const cases = [...table.matchAll(/\((null|'(\w+)'), (null|'[0-9a-f-]+'), (true|false)\)/g)].map((m) => ({
    relationship: m[2] ?? null,
    claimed_profile_id: m[3] === "null" ? null : m[3].slice(1, -1),
    expected: m[4] === "true",
  }));

  it("reads every case in the shared table", () => {
    expect(cases).toHaveLength(table.trim().split("\n").length);
    expect(cases.length).toBeGreaterThanOrEqual(13);
  });

  it("gives the SQL rule's answer for each case", () => {
    for (const { expected, ...person } of cases) {
      expect(isChildWithoutAccount(person), JSON.stringify(person)).toBe(expected);
    }
  });
});
