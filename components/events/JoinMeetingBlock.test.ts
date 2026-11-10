import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

describe("JoinMeetingBlock", () => {
  it.each([
    ["upcoming", "https://zoom.us/j/1"],
    ["upcoming", null],
    ["live", "https://zoom.us/j/1"],
    ["live", null],
    ["ended", null],
  ] as const)("gives every button in the %s block a hover no inline fill overrides", (state, url) => {
    const html = render(state, url);
    expect(buttons(html).length).toBeGreaterThan(0);
    for (const button of buttons(html)) {
      expect(button).toMatch(/hover:/);
      expect(button).not.toContain("style=");
    }
  });
});
