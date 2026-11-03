import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Entry points run Deno.serve() on import, so no test can execute them, and
// neither deno check nor the wrapper's unit tests notice one losing the check.
describe.each(["send-event-reminders", "send-serving-reminders", "clean-up-expired-data"])("%s", (name) => {
  it("serves through the caller check", () => {
    const source = readFileSync(`supabase/functions/${name}/index.ts`, "utf8");
    expect(source).toMatch(/Deno\.serve\(\s*serviceKeyCallerOnly\(/);
  });
});
