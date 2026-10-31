import { describe, expect, it } from "vitest";
import { calendarEntries, eventToICSAttributes, servingToICSAttributes } from "@/lib/ics-utils";
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

describe("calendarEntries", () => {
  const series = {
    ...event,
    id: "s1",
    title: "Study",
    // 7:00 PM in Chicago, during daylight time.
    start_time: "2026-10-23T00:00:00.000Z",
    end_time: "2026-10-23T01:30:00.000Z",
    is_cancelled: false,
    series_id: null,
    recurrence_frequency: "weekly",
    recurrence_interval: 1,
    recurrence_end_mode: "never",
  } as Event;
  const window = { start: new Date("2026-10-20T00:00:00Z"), end: new Date("2026-11-21T00:00:00Z") };
  const entries = (events: Event[]) =>
    calendarEntries(events, "America/Chicago", window.start, window.end);

  it("gives every date in the window its own UID", () => {
    expect(entries([series]).map((e) => e.uid)).toEqual([
      "s1-2026-10-22",
      "s1-2026-10-29",
      "s1-2026-11-05",
      "s1-2026-11-12",
      "s1-2026-11-19",
    ]);
  });

  it("keeps the local time across a daylight-saving change", () => {
    const starts = entries([series]).map((e) => e.event.start_time);
    expect(starts[1]).toBe("2026-10-30T00:00:00.000Z");
    expect(starts[2]).toBe("2026-11-06T01:00:00.000Z");
  });

  it("drops a deleted date and lists a moved one once, at its new time", () => {
    const deleted = {
      ...series,
      id: "x1",
      series_id: "s1",
      series_occurrence_date: "2026-10-30T00:00:00.000Z",
      recurrence_frequency: null,
      is_cancelled: true,
    } as Event;
    const moved = {
      ...deleted,
      id: "x2",
      series_occurrence_date: "2026-11-06T01:00:00.000Z",
      start_time: "2026-11-07T15:00:00.000Z",
      is_cancelled: false,
    } as Event;

    expect(entries([series, deleted, moved]).map((e) => e.uid)).toEqual([
      "s1-2026-10-22",
      "x2",
      "s1-2026-11-12",
      "s1-2026-11-19",
    ]);
  });

  it("leaves out a series that was cancelled as a whole", () => {
    expect(entries([{ ...series, is_cancelled: true }])).toEqual([]);
  });

  it("keeps a one-off event under its own id", () => {
    const oneOff = { ...event, start_time: "2026-11-01T18:00:00Z", is_cancelled: false } as Event;
    expect(entries([oneOff]).map((e) => e.uid)).toEqual(["e1"]);
  });
});

describe("join details kept out of calendars", () => {
  const page = "https://two42.io/g/g1/calendar/e1";
  const zoom = { meeting_url: "https://zoom.us/j/123?pwd=abc", meeting_id: "123", meeting_passcode: "faith" };

  it("links to the event page in place of the link, ID and passcode", () => {
    const attrs = eventToICSAttributes({ ...event, ...zoom, description: "Bring a dish" } as Event, {
      eventPageUrl: page,
    });
    expect(attrs.url).toBe(page);
    expect(attrs.description).toBe(
      `Bring a dish\n\nOnline meeting\nThe join details are on the event page: ${page}`
    );
  });

  it("adds nothing to an event without a meeting", () => {
    const attrs = eventToICSAttributes(event, { eventPageUrl: page });
    expect(attrs.url).toBeUndefined();
    expect(attrs.description).toBeUndefined();
  });
});
