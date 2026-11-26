import { describe, expect, it } from "vitest";
import { suppersICS, formatAddress } from "./ics";

describe("suppersICS", () => {
  const entry = {
    supperId: "d-1",
    startsAt: "2027-01-10T00:00:00.000Z",
    lengthMinutes: 180,
    rotationTitle: "Supper Club",
    hostNames: "Henry and Chloe",
    address: "12 Fixture Lane, Springfield, IL 62701",
  };

  it("gives each supper a stable id, its address as the location and its time in the church's zone", () => {
    const ics = suppersICS([entry], "America/Chicago");
    expect(ics).toContain("UID:supper-d-1@two42");
    expect(ics).toContain("LOCATION:12 Fixture Lane\\, Springfield\\, IL 62701");
    expect(ics).toContain("DTSTART:20270110T000000Z");
    expect(ics).toContain("Saturday\\, January 9\\, 2027 at 6:00 PM");
    expect(ics).toContain("SUMMARY:Supper Club: supper at Henry and Chloe's");
  });

  it("ends a supper at its start plus its own length", () => {
    expect(suppersICS([entry], "America/Chicago")).toContain("DTEND:20270110T030000Z");
    const short = suppersICS([{ ...entry, lengthMinutes: 90 }], "America/Chicago");
    expect(short).toContain("DTEND:20270110T013000Z");
    expect(short).not.toContain("DURATION");
  });

  it("moves a supper in place: same id, new time", () => {
    const moved = suppersICS([{ ...entry, startsAt: "2027-01-11T00:00:00.000Z" }], "America/Chicago");
    expect(moved).toContain("UID:supper-d-1@two42");
    expect(moved).toContain("DTSTART:20270111T000000Z");
    expect(moved).toContain("DTEND:20270111T030000Z");
  });

  it("is an empty calendar with no suppers", () => {
    const ics = suppersICS([], "America/Chicago");
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("VEVENT");
  });
});

describe("formatAddress", () => {
  it("joins the parts it has", () => {
    expect(formatAddress({ address_line1: "1 Main St", city: "Springfield", state: "IL", postal_code: "62701" })).toBe(
      "1 Main St, Springfield, IL 62701"
    );
    expect(formatAddress({ address_line1: "1 Main St", address_line2: "Apt 2", city: null })).toBe("1 Main St, Apt 2");
  });
});
