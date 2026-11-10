import { describe, expect, it } from "vitest";
import { meetingFieldErrors, meetingIntro } from "./MeetingFieldsSection";

describe("meetingFieldErrors", () => {
  it("accepts no meeting, or an https link", () => {
    expect(meetingFieldErrors("", "", "")).toEqual({});
    expect(meetingFieldErrors(" https://zoom.us/j/1 ", "1", "x")).toEqual({});
  });

  it("accepts a meeting ID and passcode without a link", () => {
    expect(meetingFieldErrors("", "123 456 7890", "abc")).toEqual({});
    expect(meetingFieldErrors("", "123 456 7890", "")).toEqual({});
  });

  it("marks a link that is not https", () => {
    expect(meetingFieldErrors("zoom.us/j/1", "", "").meeting_url).toMatch(/^Enter a meeting link that/);
  });

  it("marks a passcode with nothing to join", () => {
    expect(meetingFieldErrors("", "", "abc").meeting_url).toMatch(/^Enter a meeting link or a meeting ID/);
  });
});

describe("meetingIntro", () => {
  it("names Home only while the Join button shows there", () => {
    expect(meetingIntro(false, true)).toBe("Members get a Join button on Home and the event page when it is time.");
    expect(meetingIntro(false, false)).toBe("Members get a Join button on the event page when it is time.");
    expect(meetingIntro(true, true)).toBe("One meeting for every date of this event.");
  });
});
