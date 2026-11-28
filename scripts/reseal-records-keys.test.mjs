import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./reseal-records-keys.mjs", import.meta.url));

// The operator runs the script under plain node, which strips types but does not
// resolve the "@/" alias vitest and tsc do; static imports load before the env
// check, so reaching its message proves the whole import graph loads.
describe("reseal-records-keys.mjs", () => {
  it("loads under plain node and refuses to run without Supabase settings", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    expect(result.stderr).toContain(
      "ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set",
    );
    expect(result.status).toBe(1);
  });
});
