import { describe, expect, it } from "vitest";
import { calendarButtonNotes } from "@/components/events/AddToCalendarButton";
import { notesWithMeeting } from "@/lib/meetings";

describe("calendarButtonNotes", () => {
  it("writes each line of the notes and the meeting as a [br] break, with no bare line break left", () => {
    const notes = notesWithMeeting("Bring a dish\r\nPark in the back", {
      meeting_url: "https://zoom.us/j/123",
      meeting_id: "123 456 789",
      meeting_passcode: "faith",
    });
    const converted = calendarButtonNotes(notes);
    expect(converted).toBe(
      "Bring a dish[br]Park in the back[br][br]Online meeting[br]Join: https://zoom.us/j/123" +
        "[br]Meeting ID: 123 456 789[br]Passcode: faith"
    );
    expect(converted).not.toMatch(/[\r\n]/);
  });

  it("passes no notes when there are none", () => {
    expect(calendarButtonNotes(null)).toBeUndefined();
    expect(calendarButtonNotes("")).toBeUndefined();
  });
});
