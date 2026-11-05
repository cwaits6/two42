import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StartingNowEvent } from "@/lib/groups/groupHome";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement("a", { href }, children),
}));

const { StartingNowPanel } = await import("./StartingNowPanel");

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function panel(startsIn: number, recordingsHref: string | null) {
  const event: StartingNowEvent = {
    title: "Call",
    href: "/g/g1/calendar/call",
    meetingUrl: "https://zoom.us/j/1",
    meetingId: null,
    passcode: null,
    startTime: iso(startsIn),
    endTime: iso(startsIn + HOUR),
    leadMinutes: 15,
  };
  return renderToStaticMarkup(createElement(StartingNowPanel, { event, recordingsHref }));
}

describe("StartingNowPanel", () => {
  it("shows nothing for an ended event with no lesson to link to", () => {
    expect(panel(-2 * HOUR, null)).toBe("");
  });

  it("links an ended event to the lessons", () => {
    const html = panel(-2 * HOUR, "/g/g1/lectures");
    expect(html).toContain("This event has ended");
    expect(html).toContain('href="/g/g1/lectures"');
    expect(html).toContain("Watch the recording");
  });

  it("shows a live event its join link, with or without lessons", () => {
    for (const recordingsHref of [null, "/g/g1/lectures"]) {
      const html = panel(-HOUR / 2, recordingsHref);
      expect(html).toContain("Starting now");
      expect(html).toContain('href="https://zoom.us/j/1"');
      expect(html).not.toContain("Watch the recording");
    }
  });

  it("shows an event whose join window has opened before it starts", () => {
    const html = panel(HOUR / 12, null);
    expect(html).toContain("Starting now");
    expect(html).toContain('href="https://zoom.us/j/1"');
  });
});
