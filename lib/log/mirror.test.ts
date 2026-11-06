import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("the edge functions' copy of the log core is identical to lib's", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  expect(read("supabase/functions/_shared/log.ts")).toBe(read("lib/log/core.ts"));
});
