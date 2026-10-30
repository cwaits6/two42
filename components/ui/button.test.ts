import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";

const FLOOR_PX = 44;
// Tailwind's spacing scale: one unit is 0.25rem at the 16 px root size.
const SPACING_PX = 4;
const SIZES = ["default", "sm", "lg", "icon", "icon-sm", "icon-lg"] as const;

function scalePx(classes: string[], prefix: string): number {
  const units = classes
    .filter((c) => c.startsWith(`${prefix}-`))
    .map((c) => Number(c.slice(prefix.length + 1)))
    .find(Number.isFinite);
  if (units === undefined) throw new Error(`no ${prefix}-<n> class`);
  return units * SPACING_PX;
}

describe("Button touch target", () => {
  it.each(SIZES)("is at least 44 px tall at size %s", (size) => {
    const classes = buttonVariants({ size }).split(/\s+/);
    const prefix = size.startsWith("icon") ? "size" : "h";
    expect(scalePx(classes, prefix)).toBeGreaterThanOrEqual(FLOOR_PX);
  });

  it.each(SIZES)("sets no label below text-sm at size %s", (size) => {
    expect(buttonVariants({ size })).not.toMatch(/\btext-(xs|\[)/);
  });
});
