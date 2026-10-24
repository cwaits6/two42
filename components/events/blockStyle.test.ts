import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { blockStyle } from "./blockStyle";

describe("blockStyle", () => {
  it("uses white text on a dark group colour", () => {
    expect(blockStyle("#1F4E79")).toEqual({ backgroundColor: "#1F4E79", color: "#FFFFFF" });
  });

  it("uses Espresso text on a light group colour", () => {
    expect(blockStyle("#F2C94C")).toEqual({ backgroundColor: "#F2C94C", color: "#2A211A" });
  });

  it("moves a mid-grey colour to the light surface with a left border", () => {
    const style = blockStyle("#7A7A7A");
    expect(style.backgroundColor).toBe("var(--color-brand-bg-light)");
    expect(style.borderLeft).toBe("4px solid #7A7A7A");
    expect(contrastRatio("#FAEBC2", style.color as string)).toBeGreaterThanOrEqual(4.5);
  });

  it("passes a non-hex colour through with white text", () => {
    expect(blockStyle("var(--color-brand-primary)")).toEqual({
      backgroundColor: "var(--color-brand-primary)",
      color: "#FFFFFF",
    });
  });
});
