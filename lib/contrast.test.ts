// The hover fill is derived from the validated accent, so it is never
// validated itself: these tests pin the derivation and the property that
// makes that safe. The tokens live in app/globals.css as literals, so nothing
// but a test ties them to the 4.5:1 floor this app promises for brand text.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCENT_CONTRAST_MIN,
  ACCENT_CONTRAST_REFERENCE,
  contrastRatio,
  validateAccent,
} from "@/lib/contrast";

describe("brand text tokens in app/globals.css", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const hexTokens = new Map<string, string>();
  for (const [, name, hex] of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    if (!hexTokens.has(name)) hexTokens.set(name, hex);
  }
  const token = (name: string): string => {
    const hex = hexTokens.get(name);
    if (!hex) throw new Error(`${name} is not declared as a 6-digit hex in app/globals.css`);
    return hex;
  };

  // `over` composited at `alpha` onto `under`, the way a 10% background tint
  // or an sRGB color-mix renders.
  const composite = (over: string, under: string, alpha: number): string => {
    const o = parseInt(over.slice(1), 16);
    const u = parseInt(under.slice(1), 16);
    const channel = (shift: number) =>
      Math.round(((o >> shift) & 0xff) * alpha + ((u >> shift) & 0xff) * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    return `#${channel(16)}${channel(8)}${channel(0)}`;
  };

  const paper = token("--background");
  const card = token("--card");
  const warm = token("--color-brand-warm");
  const lightGrounds = { paper, card, warm };

  it.each([
    ["--color-brand-primary-text"],
    ["--color-brand-accent-text"],
    ["--destructive"],
  ])("%s holds 4.5:1 on Warm Paper, card, and brand-warm", (name) => {
    for (const ground of Object.values(lightGrounds)) {
      expect(contrastRatio(token(name), ground)).toBeGreaterThanOrEqual(ACCENT_CONTRAST_MIN);
    }
  });

  it("the destructive Button reads at rest on its 10% tint and on hover as white on the solid red", () => {
    const red = token("--destructive");
    for (const ground of Object.values(lightGrounds)) {
      expect(contrastRatio(red, composite(red, ground, 0.1))).toBeGreaterThanOrEqual(
        ACCENT_CONTRAST_MIN,
      );
    }
    expect(contrastRatio("#FFFFFF", red)).toBeGreaterThanOrEqual(ACCENT_CONTRAST_MIN);
  });

  describe("--primary-hover", () => {
    const declaration = css.match(
      /--primary-hover:\s*color-mix\(in srgb, var\(--primary\) (\d+)%, black\);/,
    );
    if (!declaration) {
      throw new Error("--primary-hover is not declared as a color-mix of --primary toward black");
    }
    const hoverOf = (accent: string) => composite(accent, "#000000", Number(declaration[1]) / 100);

    it("darkens Clay to the documented solid hover", () => {
      expect(hoverOf(token("--primary")).toUpperCase()).toBe("#A65332");
    });

    it("yields a hover at or above 4.5:1 with white text for an accent that only just passes", () => {
      // 4.5000006:1 against white — the closest 6-digit hex to the floor.
      const accent = "#7C7290";
      const solid = validateAccent(accent);
      expect(solid.ok).toBe(true);
      if (!solid.ok) return;
      expect(solid.ratio).toBeLessThan(4.51);

      expect(contrastRatio(hoverOf(accent), ACCENT_CONTRAST_REFERENCE)).toBeGreaterThanOrEqual(
        ACCENT_CONTRAST_MIN,
      );
    });

    it("never scores lower against white than the accent it came from", () => {
      for (const accent of ["#B85C38", "#7C7290", "#2563EB", "#000000", "#FFFFFF", "#808080"]) {
        expect(contrastRatio(hoverOf(accent), ACCENT_CONTRAST_REFERENCE)).toBeGreaterThanOrEqual(
          contrastRatio(accent, ACCENT_CONTRAST_REFERENCE),
        );
      }
    });
  });
});
