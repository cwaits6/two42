import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import type { JoinState } from "@/lib/meetings";

const join = vi.hoisted(() => ({ state: "upcoming" as JoinState }));
vi.mock("@/components/events/useJoinState", () => ({ useJoinState: () => join.state }));

const { JoinMeetingBlock } = await import("./JoinMeetingBlock");

function render(state: JoinState, meetingUrl: string | null) {
  join.state = state;
  return renderToStaticMarkup(
    createElement(JoinMeetingBlock, {
      meetingUrl,
      meetingId: "123 456 789",
      passcode: "abc",
      startTime: "2026-11-10T00:00:00Z",
      endTime: "2026-11-10T01:00:00Z",
      leadMinutes: 10,
      timeZone: "America/Chicago",
      recordingsHref: "/g/group/lectures",
    }),
  );
}

const buttons = (html: string) => [...html.matchAll(/<(?:a|button) [^>]*>/g)].map((m) => m[0]);
const surfaces = (html: string) =>
  [...html.matchAll(/<(?:a|button|div) [^>]*>/g)].map((m) => m[0]);

type Fill = { hover: boolean; token: string; alpha: number };
const fills = (tag: string): Fill[] =>
  [...tag.matchAll(/(?<![\w:-])(hover:)?bg-([a-z-]+)\/(\d+)\b/g)].map(([, hover, token, alpha]) => ({
    hover: !!hover,
    token,
    alpha: Number(alpha) / 100,
  }));

const css = readFileSync(joinPath(process.cwd(), "app/globals.css"), "utf8");
const TOKENS = {
  "--primary": /--primary:\s*(#[0-9a-fA-F]{6});/,
  "--primary-foreground": /--primary-foreground:\s*(#[0-9a-fA-F]{6});/,
  "--foreground": /--foreground:\s*(#[0-9a-fA-F]{6});/,
  "--color-brand-accent": /--color-brand-accent:\s*(#[0-9a-fA-F]{6});/,
} as const;
const hexToken = (name: keyof typeof TOKENS): string => {
  const match = css.match(TOKENS[name]);
  if (!match) throw new Error(`${name} is not declared as a 6-digit hex in app/globals.css`);
  return match[1];
};

// `over` composited at `alpha` onto `under`, the way a translucent fill renders.
const composite = (over: string, under: string, alpha: number): string => {
  const o = parseInt(over.slice(1), 16);
  const u = parseInt(under.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((o >> shift) & 0xff) * alpha + ((u >> shift) & 0xff) * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
};

const states = [
  ["upcoming", "https://zoom.us/j/1"],
  ["upcoming", null],
  ["live", "https://zoom.us/j/1"],
  ["live", null],
  ["ended", null],
] as const;

describe("JoinMeetingBlock", () => {
  it.each(states)("gives every button in the %s block a hover no inline fill overrides", (state, url) => {
    const html = render(state, url);
    expect(buttons(html).length).toBeGreaterThan(0);
    for (const button of buttons(html)) {
      expect(button).toMatch(/hover:/);
      expect(button).not.toContain("style=");
    }
  });

  it.each(states)("darkens the %s block's panels and buttons, more on hover", (state, url) => {
    const html = render(state, url);
    for (const tag of surfaces(html)) {
      const tagFills = fills(tag);
      for (const fill of tagFills) expect(fill.token, tag).toBe("foreground");
      const base = tagFills.find((fill) => !fill.hover);
      const hover = tagFills.find((fill) => fill.hover);
      if (base && hover) expect(hover.alpha, tag).toBeGreaterThan(base.alpha);
    }
  });

  it.each(states)("keeps white text at 4.5:1 on every fill in the %s block over Clay", (state, url) => {
    const clay = hexToken("--primary");
    const espresso = hexToken("--foreground");
    const white = hexToken("--primary-foreground");
    expect(contrastRatio(clay, white)).toBeGreaterThanOrEqual(4.5);
    for (const fill of surfaces(render(state, url)).flatMap(fills)) {
      expect(contrastRatio(composite(espresso, clay, fill.alpha), white)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the live Join button's text at 4.5:1 when hovered", () => {
    const html = render("live", "https://zoom.us/j/1");
    expect(surfaces(html)[0]).toMatch(/\bbg-brand-primary-hover\b/);
    const join = buttons(html).find((tag) => tag.includes("bg-brand-accent"));
    expect(join).toBeDefined();
    const opacity = Number(join!.match(/hover:opacity-(\d+)\b/)?.[1] ?? 100) / 100;
    // --primary-hover mixes Clay with black. Opacity fades the button's text along with
    // its fill, so both are composited onto the panel.
    const panel = composite("#000000", hexToken("--primary"), 0.1);
    const fill = composite(hexToken("--color-brand-accent"), panel, opacity);
    const text = composite(hexToken("--foreground"), panel, opacity);
    expect(contrastRatio(fill, text)).toBeGreaterThanOrEqual(4.5);
  });
});
