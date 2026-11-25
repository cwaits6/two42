import { describe, expect, it } from "vitest";
import { endFromMonths, proposeDinnerDates, seasonDateStarts } from "./dates";

describe("proposeDinnerDates", () => {
  it("proposes five Saturdays for a four-month season every 4 weeks from 2027-01-09", () => {
    const endsOn = endFromMonths("2027-01-09", 4);
    expect(endsOn).toBe("2027-05-08");
    expect(
      proposeDinnerDates({
        startsOn: "2027-01-09",
        endsOn,
        repeat: { kind: "weeks", everyWeeks: 4 },
        weekday: 6,
        startTime: "18:00",
      })
    ).toEqual([
      "2027-01-09T18:00",
      "2027-02-06T18:00",
      "2027-03-06T18:00",
      "2027-04-03T18:00",
      "2027-05-01T18:00",
    ]);
  });

  it("starts on the first chosen weekday when the start date is another day", () => {
    expect(
      proposeDinnerDates({
        startsOn: "2027-01-04",
        endsOn: "2027-01-31",
        repeat: { kind: "weeks", everyWeeks: 2 },
        weekday: 6,
        startTime: "17:30",
      })
    ).toEqual(["2027-01-09T17:30", "2027-01-23T17:30"]);
  });

  it("proposes the 2nd Saturday of each month", () => {
    expect(
      proposeDinnerDates({
        startsOn: "2027-01-01",
        endsOn: "2027-04-30",
        repeat: { kind: "monthly_weekday", weekOfMonth: 2 },
        weekday: 6,
        startTime: "18:00",
      })
    ).toEqual(["2027-01-09T18:00", "2027-02-13T18:00", "2027-03-13T18:00", "2027-04-10T18:00"]);
  });

  it("proposes the last Friday of each month", () => {
    expect(
      proposeDinnerDates({
        startsOn: "2027-01-01",
        endsOn: "2027-03-31",
        repeat: { kind: "monthly_weekday", weekOfMonth: 5 },
        weekday: 5,
        startTime: "19:00",
      })
    ).toEqual(["2027-01-29T19:00", "2027-02-26T19:00", "2027-03-26T19:00"]);
  });

  it("leaves out a monthly date before the start or after an end date given directly", () => {
    expect(
      proposeDinnerDates({
        startsOn: "2027-01-10",
        endsOn: "2027-03-12",
        repeat: { kind: "monthly_weekday", weekOfMonth: 2 },
        weekday: 6,
        startTime: "18:00",
      })
    ).toEqual(["2027-02-13T18:00"]);
  });

  it("proposes nothing when the end is before the start", () => {
    expect(
      proposeDinnerDates({
        startsOn: "2027-02-01",
        endsOn: "2027-01-01",
        repeat: { kind: "weeks", everyWeeks: 1 },
        weekday: 0,
        startTime: "18:00",
      })
    ).toEqual([]);
  });
});

describe("endFromMonths", () => {
  it("keeps to the end of a shorter month", () => {
    expect(endFromMonths("2027-01-31", 1)).toBe("2027-02-27");
  });
});

describe("seasonDateStarts", () => {
  it("reads each proposed time in the church's zone", () => {
    expect(
      seasonDateStarts(
        {
          starts_on: "2027-01-09",
          ends_on: "2027-02-06",
          repeat_kind: "weeks",
          repeat_weeks: 4,
          repeat_week_of_month: null,
          weekday: 6,
          default_start_time: "18:00:00",
        },
        "America/Chicago"
      )
    ).toEqual(["2027-01-10T00:00:00.000Z", "2027-02-07T00:00:00.000Z"]);
  });
});
