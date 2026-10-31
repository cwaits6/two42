import { describe, expect, it } from "vitest";
import { meetingFieldErrors } from "./MeetingFieldsSection";

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
