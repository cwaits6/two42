import { describe, expect, it } from "vitest";
import { meetingFieldErrors } from "./MeetingFieldsSection";

describe("meetingFieldErrors", () => {
  it("accepts no meeting, or an https link", () => {
    expect(meetingFieldErrors("", "", "")).toEqual({});
    expect(meetingFieldErrors(" https://zoom.us/j/1 ", "1", "x")).toEqual({});
  });

  it("marks a link that is not https", () => {
    expect(meetingFieldErrors("zoom.us/j/1", "", "").meeting_url).toMatch(/^Enter a meeting link/);
  });

  it("marks a missing link when an ID or passcode is given", () => {
    expect(meetingFieldErrors("", "123", "").meeting_url).toMatch(/^Enter the meeting link/);
    expect(meetingFieldErrors("", "", "abc").meeting_url).toMatch(/^Enter the meeting link/);
  });
});
