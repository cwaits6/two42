import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The size regressions these guard against are invisible in a static render:
// a `text-sm` helper or a `size="sm"` button renders fine and only measures
// short in a browser, so the source is the honest place to catch them.
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
const sources = Object.fromEntries(
  files.map((f) => [f, readFileSync(path.join(dir, f), "utf8")]),
);

describe("teams manager floor", () => {
  it("covers every component in the directory", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "IconPicker.tsx",
        "RemoveTeamDialog.tsx",
        "TeamRosterDialog.tsx",
        "TeamsManager.tsx",
        "page.tsx",
      ]),
    );
  });

  it.each(files)("%s sets no copy below text-base", (file) => {
    expect(sources[file]).not.toMatch(/\btext-(xs|sm)\b/);
  });

  it.each(files)("%s uses no button size under 44 px", (file) => {
    expect(sources[file]).not.toMatch(/size=["'](xs|sm|icon-xs|icon-sm)["']/);
  });

  it.each(files)("%s never falls back to a browser confirm or alert", (file) => {
    expect(sources[file]).not.toMatch(/\b(window\.)?(confirm|alert)\(/);
  });

  it("confirms removing a team through the shared dialog", () => {
    expect(sources["TeamsManager.tsx"]).toContain("<RemoveTeamDialog");
  });
});
