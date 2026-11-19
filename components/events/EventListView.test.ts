// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notesAdded: (string | null | undefined)[] = [];
vi.mock("@/components/events/AddToCalendarButton", () => ({
  AddToCalendarButton: ({ description }: { description?: string | null }) => {
    notesAdded.push(description);
    return null;
  },
}));

const { EventListView } = await import("./EventListView");

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  notesAdded.length = 0;
});

const NEXT_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const MOVED_DATE = {
  id: "moved",
  group_id: "g1",
  title: "Group night",
  description: "Moved to Thursday",
  location: null,
  start_time: NEXT_WEEK,
  end_time: null,
  is_rsvp_enabled: false,
  recurrence_frequency: null,
  series_id: "anchor",
  series_occurrence_date: NEXT_WEEK,
  is_cancelled: false,
  meeting_url: null,
  meeting_id: null,
  meeting_passcode: null,
} as Event;

describe("EventListView Add to calendar", () => {
  it("adds a moved date of a repeating event with the series' meeting", () => {
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() =>
      root!.render(
        createElement(EventListView, {
          groups: [{ id: "g1", name: "Group", color: "#b4532a", isLeader: false }],
          events: [MOVED_DATE],
          replies: [],
          userId: "u1",
          createHref: null,
          timeZone: "America/Chicago",
          viewSwitch: null,
          seriesMeetings: new Map([
            ["anchor", { meeting_url: "https://zoom.us/j/123", meeting_id: "123", meeting_passcode: "faith" }],
          ]),
        })
      )
    );
    expect(notesAdded.at(-1)).toBe(
      "Moved to Thursday\n\nOnline meeting\nJoin: https://zoom.us/j/123\nMeeting ID: 123\nPasscode: faith"
    );
  });
});
