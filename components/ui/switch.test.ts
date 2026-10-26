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

function arbitraryPx(classes: string[], prefix: string): number {
  const re = new RegExp(`^${prefix.replace(/[[\]]/g, "\\$&")}\\[([\\d.]+)px\\]$`);
  const hit = classes.map((c) => c.match(re)).find(Boolean);
  if (!hit) throw new Error(`no ${prefix}[...px] class`);
  return Number(hit[1]);
}

function negativeInset(classes: string[], axis: "x" | "y"): number {
  const re = new RegExp(`^after:-inset-${axis}-([\\d.]+)$`);
  const hit = classes.map((c) => c.match(re)).find(Boolean);
  if (!hit) throw new Error(`no after:-inset-${axis} class`);
  return Number(hit[1]) * SPACING_PX;
}

describe("Switch hit area", () => {
  it("extends the hit area with a positioned pseudo-element", () => {
    const classes = rootClasses("default");
    expect(classes).toContain("relative");
    expect(classes).toContain("after:absolute");
  });

  it.each(["default", "sm"] as const)("reaches the 44 px floor at size %s", (size) => {
    const classes = rootClasses(size);
    const height = arbitraryPx(classes, `data-[size=${size}]:h-`);
    const width = arbitraryPx(classes, `data-[size=${size}]:w-`);
    expect(height + 2 * negativeInset(classes, "y")).toBeGreaterThanOrEqual(FLOOR_PX);
    expect(width + 2 * negativeInset(classes, "x")).toBeGreaterThanOrEqual(FLOOR_PX);
  });
});
