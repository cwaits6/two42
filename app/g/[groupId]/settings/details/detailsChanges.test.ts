import { describe, expect, it } from "vitest";
import { colorError, detailsChanges, type DetailsFields } from "./detailsChanges";

const saved: DetailsFields = {
  color: "#B85C38",
  calendar: { calendar_meeting_details: true, calendar_event_notes: true, calendar_event_location: false },
  reminders: { enabled: true, defaultDays: 1 },
};

describe("detailsChanges", () => {
  it("is empty when nothing changed", () => {
    expect(detailsChanges(saved, structuredClone(saved))).toEqual({});
  });

  it("carries the color when it changed", () => {
    expect(detailsChanges(saved, { ...saved, color: "#2A211A" })).toEqual({ color: "#2A211A" });
  });

  it("carries only the settings columns that changed", () => {
    expect(
      detailsChanges(saved, {
        ...saved,
        calendar: { ...saved.calendar, calendar_event_notes: false },
        reminders: { enabled: true, defaultDays: 7 },
      }),
    ).toEqual({ settings: { calendar_event_notes: false, event_reminder_default_days: 7 } });
  });

  it("names the reminders switch by its column", () => {
    expect(detailsChanges(saved, { ...saved, reminders: { enabled: false, defaultDays: 1 } })).toEqual({
      settings: { event_reminders_enabled: false },
    });
  });
});

describe("field errors", () => {
  it("accepts only a color that can carry legible text", () => {
    expect(colorError("#B85C38")).toBeUndefined();
    expect(colorError("#7d7d7d")).toBeDefined();
    expect(colorError("red")).toBeDefined();
  });
});
