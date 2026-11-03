import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Entry points run Deno.serve() on import, so no test can execute them. Every
// one of these functions is started only by pg_cron with a service key.
const FUNCTIONS = readdirSync("supabase/functions", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !["_shared", "tests"].includes(entry.name))
  .map((entry) => entry.name);

describe("edge function entry points", () => {
  it("finds the functions", () => {
    expect(FUNCTIONS).toEqual(
      expect.arrayContaining(["send-event-reminders", "send-serving-reminders", "clean-up-expired-data"]),
    );
  });

  it.each(FUNCTIONS)("%s serves only through the caller check", (name) => {
    const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
    expect(source).toContain("Deno.serve(serviceKeyCallerOnly(");
    expect(source.match(/Deno\.serve\(/g)).toHaveLength(1);
  });
});
