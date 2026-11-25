import { describe, expect, it } from "vitest";
import { dinnersICS, formatAddress } from "./ics";

describe("dinnersICS", () => {
  const entry = {
    dinnerId: "d-1",
    startsAt: "2027-01-10T00:00:00.000Z",
    seasonTitle: "Supper Club",
    hostNames: "Henry and Chloe",
    address: "12 Fixture Lane, Springfield, IL 62701",
  };

  it("gives each dinner a stable id, its address as the location and its time in the church's zone", () => {
    const ics = dinnersICS([entry], "America/Chicago");
    expect(ics).toContain("UID:dinner-d-1@two42");
    expect(ics).toContain("LOCATION:12 Fixture Lane\\, Springfield\\, IL 62701");
    expect(ics).toContain("DTSTART:20270110T000000Z");
    expect(ics).toContain("Saturday\\, January 9\\, 2027 at 6:00 PM");
    expect(ics).toContain("SUMMARY:Supper Club: dinner at Henry and Chloe's");
  });

  it("moves a dinner in place: same id, new time", () => {
    const moved = dinnersICS([{ ...entry, startsAt: "2027-01-11T00:00:00.000Z" }], "America/Chicago");
    expect(moved).toContain("UID:dinner-d-1@two42");
    expect(moved).toContain("DTSTART:20270111T000000Z");
  });

  it("is an empty calendar with no dinners", () => {
    const ics = dinnersICS([], "America/Chicago");
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
