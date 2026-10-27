import { readdirSync, readFileSync, statSync } from "node:fs";
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

const groupDir = path.resolve(dir, "..", "..");
if (path.basename(path.dirname(groupDir)) !== "g") {
  throw new Error(`expected the group route directory, got ${groupDir}`);
}

function componentFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) return componentFiles(full);
    return entry.endsWith(".tsx") ? [path.relative(groupDir, full)] : [];
  });
}

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

describe("group pages", () => {
  const files = componentFiles(groupDir);

  it("reach every route under the group", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "calendar/[id]/edit/EditEventForm.tsx",
        "settings/about/AboutEditor.tsx",
        "settings/teams/TeamsManager.tsx",
      ]),
    );
  });

  it.each(files)("%s never falls back to a browser confirm or alert", (file) => {
    const source = readFileSync(path.join(groupDir, file), "utf8");
    expect(source).not.toMatch(/\b(window\.)?(confirm|alert)\(/);
  });
});
