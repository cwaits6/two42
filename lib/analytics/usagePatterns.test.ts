import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_PATTERNS } from "./pagePattern";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const DEFINITION = /function public\.usage_page_patterns\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/;

/** The patterns in the newest migration that defines usage_page_patterns(). */
function databasePatterns(): string[] {
  const newest = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .reverse()
    .map((name) => readFileSync(join(MIGRATIONS, name), "utf8").match(DEFINITION))
    .find((match) => match !== null);
  if (!newest) throw new Error("no migration defines public.usage_page_patterns()");
  return [...newest[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

describe("usage_page_patterns()", () => {
  // A page missing from the database list is never counted, and nothing else would say so.
  it("accepts exactly the pages in PAGE_PATTERNS", () => {
    expect(databasePatterns().sort()).toEqual([...PAGE_PATTERNS].sort());
  });
});
