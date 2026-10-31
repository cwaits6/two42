import { describe, expect, it } from "vitest";
import { hasMeeting, notesWithMeeting } from "@/lib/meetings";

const none = { meeting_url: null, meeting_id: null, meeting_passcode: null };

describe("hasMeeting", () => {
  it("needs a link or an ID", () => {
    expect(hasMeeting({ meeting_url: "https://zoom.us/j/1", meeting_id: null })).toBe(true);
    expect(hasMeeting({ meeting_url: null, meeting_id: "123" })).toBe(true);
    expect(hasMeeting({ meeting_url: null, meeting_id: "  " })).toBe(false);
  });
});

describe("notesWithMeeting", () => {
  it("appends the meeting after the event's own notes", () => {
    expect(
      notesWithMeeting("Bring a dish", { meeting_url: null, meeting_id: "123", meeting_passcode: "faith" })
    ).toBe("Bring a dish\n\nOnline meeting\nMeeting ID: 123\nPasscode: faith");
  });

  it("leaves the notes alone without a meeting", () => {
    expect(notesWithMeeting("Bring a dish", none)).toBe("Bring a dish");
    expect(notesWithMeeting("Bring a dish", null)).toBe("Bring a dish");
    expect(notesWithMeeting(null, none)).toBeNull();
  });

  it("ignores a passcode with nothing to join", () => {
    expect(notesWithMeeting(null, { ...none, meeting_passcode: "faith" })).toBeNull();
  });
});
