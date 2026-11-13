import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { USAGE_KINDS } from "./recordUsage";

const MIGRATION = readFileSync(join(process.cwd(), "supabase", "migrations", "20261126000000_usage_counts.sql"), "utf8");

function kindList(pattern: RegExp): string[] {
  const match = MIGRATION.match(pattern);
  if (!match) throw new Error(`usage_counts migration has no kind list matching ${pattern}`);
  return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
}

describe("usage kinds", () => {
  // A kind the database refuses is dropped quietly by the recorder, and one the
  // pages don't rank is never shown; neither failure says so anywhere else.
  it("match the column check and the writer's check", () => {
    const kinds = [...USAGE_KINDS].sort();
    expect(kindList(/kind text not null check \(kind in \(([^)]*)\)\)/)).toEqual(kinds);
    expect(kindList(/_kind not in \(([^)]*)\)/)).toEqual(kinds);
  });
});
