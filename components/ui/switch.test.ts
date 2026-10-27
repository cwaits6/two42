import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch";

const FLOOR_PX = 44;
// Tailwind's spacing scale: one unit is 0.25rem at the 16 px root size.
const SPACING_PX = 4;

function rootClasses(size: "sm" | "default"): string[] {
  const html = renderToStaticMarkup(createElement(Switch, { size }));
  const match = html.match(/role="switch"[^>]*\sclass="([^"]*)"/);
  if (!match) throw new Error("switch root did not render");
  return match[1].split(/\s+/);
}

function scalePx(classes: string[], prefix: string): number {
  const units = classes
    .filter((c) => c.startsWith(`${prefix}-`))
    .map((c) => Number(c.slice(prefix.length + 1)))
    .find(Number.isFinite);
  if (units === undefined) throw new Error(`no ${prefix}-<n> class`);
  return units * SPACING_PX;
}

describe("Switch touch target", () => {
  it.each(["default", "sm"] as const)(
    "reserves a 44 px box in layout at size %s",
    (size) => {
      const classes = rootClasses(size);
      expect(scalePx(classes, "h")).toBeGreaterThanOrEqual(FLOOR_PX);
      expect(scalePx(classes, "min-w")).toBeGreaterThanOrEqual(FLOOR_PX);
    },
  );

  it("does not reach past its own box into neighbouring controls", () => {
    const classes = rootClasses("default");
    expect(classes.some((c) => c.startsWith("after:"))).toBe(false);
    expect(classes).not.toContain("absolute");
  });

  it("keeps the track inside the target", () => {
    const html = renderToStaticMarkup(createElement(Switch, {}));
    expect(html).toMatch(/role="switch"[\s\S]*data-slot="switch-track"[\s\S]*data-slot="switch-thumb"/);
  });
});
