import { describe, expect, it } from "vitest";
import { eventSharing, hasOwnSharing, sharingColumns, sharingSummary, SHARE_ALL } from "@/lib/calendar/sharing";

const follows = { calendar_meeting_details: null, calendar_event_notes: null, calendar_event_location: null };
const groupKeepsJoin = { joinDetails: false, notes: true, location: true };

describe("eventSharing", () => {
  it("follows the group when the event made no choice", () => {
    expect(eventSharing(groupKeepsJoin, follows)).toEqual(groupKeepsJoin);
    expect(hasOwnSharing(follows)).toBe(false);
  });

  it("uses the event's own choice over the group's", () => {
    const own = { calendar_meeting_details: true, calendar_event_notes: false, calendar_event_location: true };
    expect(eventSharing(groupKeepsJoin, own)).toEqual({ joinDetails: true, notes: false, location: true });
    expect(hasOwnSharing(own)).toBe(true);
  });
});

describe("sharingColumns", () => {
  it("saves nulls to follow the group, or the event's own choice", () => {
    expect(sharingColumns(null)).toEqual(follows);
    expect(sharingColumns(SHARE_ALL)).toEqual({
      calendar_meeting_details: true,
      calendar_event_notes: true,
      calendar_event_location: true,
    });
  });
});

describe("sharingSummary", () => {
  it("says what is shared and what stays on the event page", () => {
    expect(sharingSummary(SHARE_ALL)).toBe("Shares join details, notes and location.");
    expect(sharingSummary({ joinDetails: false, notes: true, location: true })).toBe(
      "Shares notes and location. Keeps join details on the event page."
    );
    expect(sharingSummary({ joinDetails: false, notes: false, location: false })).toBe(
      "Keeps join details, notes and location on the event page."
    );
  });
});
