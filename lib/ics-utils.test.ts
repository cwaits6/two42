import { describe, expect, it } from "vitest";
import { eventToICSAttributes, servingToICSAttributes } from "@/lib/ics-utils";
import type { Event } from "@/lib/types";

const event = {
  id: "e1",
  group_id: "g1",
  title: "Potluck",
  description: null,
  location: null,
  start_time: "2026-10-20T18:00:00Z",
  end_time: null,
} as Event;

describe("summary prefix", () => {
  it("prefixes an event title with the group name on the merged feed", () => {
    expect(eventToICSAttributes(event, { summaryPrefix: "Grace" }).title).toBe("Grace: Potluck");
  });

  it("leaves an event title alone without a prefix", () => {
    expect(eventToICSAttributes(event).title).toBe("Potluck");
  });

  it("prefixes a serving signup with the group name on the merged feed", () => {
    expect(
      servingToICSAttributes({
        signupId: "s1",
        serviceDate: "2026-10-25",
        teamName: "Greeters",
        summaryPrefix: "Grace",
      }).title
    ).toBe("Grace: Serving: Greeters");
  });

  it("leaves a serving signup alone without a prefix", () => {
    expect(
      servingToICSAttributes({ signupId: "s1", serviceDate: "2026-10-25", teamName: "Greeters" }).title
    ).toBe("Serving: Greeters");
  });
});

describe("online meeting", () => {
  const zoom = {
    meeting_url: "https://zoom.us/j/123?pwd=abc",
    meeting_id: "123 456 7890",
    meeting_passcode: "faith",
  };

  it("puts the link in the event URL and the details in the notes", () => {
    const attrs = eventToICSAttributes({ ...event, ...zoom, description: "Bring a dish" } as Event);
    expect(attrs.url).toBe(zoom.meeting_url);
    expect(attrs.description).toBe(
      "Bring a dish\n\nOnline meeting\nJoin: https://zoom.us/j/123?pwd=abc\nMeeting ID: 123 456 7890\nPasscode: faith"
    );
  });

  it("carries a meeting ID and passcode with no link", () => {
    const attrs = eventToICSAttributes({
      ...event,
      meeting_url: null,
      meeting_id: "123 456 7890",
      meeting_passcode: "faith",
    } as Event);
    expect(attrs.url).toBeUndefined();
    expect(attrs.description).toBe("Online meeting\nMeeting ID: 123 456 7890\nPasscode: faith");
  });

  it("uses the series meeting for an exception row", () => {
    const attrs = eventToICSAttributes({ ...event, series_id: "anchor" } as Event, { meeting: zoom });
    expect(attrs.url).toBe(zoom.meeting_url);
    expect(attrs.description).toContain("Meeting ID: 123 456 7890");
  });

  it("adds nothing for an event without a meeting", () => {
    const attrs = eventToICSAttributes(event);
    expect(attrs.url).toBeUndefined();
    expect(attrs.description).toBeUndefined();
  });
});
