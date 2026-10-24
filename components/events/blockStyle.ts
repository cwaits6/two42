import type { CSSProperties } from "react";
import { contrastRatio, HEX } from "@/lib/contrast";
import { groupTextColor } from "@/lib/groups/settings";

const MIN_TEXT_RATIO = 4.5;

/**
 * Inline styles for an event block in a group's colour. A colour that reads at
 * 4.5:1 under neither white nor Espresso text goes on the light surface
 * instead, carrying the group colour as a left border so its identity stays.
 */
export function blockStyle(color: string): CSSProperties {
  if (!HEX.test(color)) return { backgroundColor: color, color: "#FFFFFF" };
  const text = groupTextColor(color);
  if (contrastRatio(color, text) >= MIN_TEXT_RATIO) {
    return { backgroundColor: color, color: text };
  }
  return {
    backgroundColor: "var(--color-brand-bg-light)",
    color: text,
    borderLeft: `4px solid ${color}`,
  };
}
