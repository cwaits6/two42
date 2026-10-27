// The hover fill is derived from the validated accent, so it is never
// validated itself: these tests pin the property that makes that safe.

import { describe, expect, it } from "vitest";
import {
  ACCENT_CONTRAST_MIN,
  ACCENT_CONTRAST_REFERENCE,
  accentHover,
  contrastRatio,
  HEX,
  validateAccent,
} from "@/lib/contrast";

describe("accentHover", () => {
  it("darkens Clay to the documented solid hover", () => {
    expect(accentHover("#B85C38")).toBe("#A65332");
  });

  it("yields a hover at or above 4.5:1 with white text for an accent that only just passes", () => {
    // 4.5000006:1 against white — the closest 6-digit hex to the floor.
    const accent = "#7C7290";
    const solid = validateAccent(accent);
    expect(solid.ok).toBe(true);
    if (!solid.ok) return;
    expect(solid.ratio).toBeLessThan(4.51);

    const hover = accentHover(accent);
    expect(contrastRatio(hover, ACCENT_CONTRAST_REFERENCE)).toBeGreaterThanOrEqual(
      ACCENT_CONTRAST_MIN,
    );
  });

  it("never scores lower against white than the accent it came from", () => {
    for (const accent of ["#B85C38", "#7C7290", "#2563EB", "#000000", "#FFFFFF", "#808080"]) {
      expect(contrastRatio(accentHover(accent), ACCENT_CONTRAST_REFERENCE)).toBeGreaterThanOrEqual(
        contrastRatio(accent, ACCENT_CONTRAST_REFERENCE),
      );
    }
  });

  it("keeps the strict hex shape the <style> block relies on", () => {
    for (const accent of ["#B85C38", "#000000", "#FFFFFF", "#010203", "#abcdef"]) {
      expect(accentHover(accent)).toMatch(HEX);
    }
  });
});
