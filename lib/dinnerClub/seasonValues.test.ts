import { describe, expect, it } from "vitest";
import { nextSeasonValues, valuesFromSeason } from "./seasonValues";

const ended = {
  title: "Spring Supper Club",
  format: "same_table_rotating" as const,
  starts_on: "2027-01-01",
  ends_on: "2027-04-30",
  length_months: null,
  repeat_kind: "monthly_weekday",
  repeat_weeks: null,
  repeat_week_of_month: 3,
  weekday: 5,
  default_start_time: "18:30:00",
  table_size_min: 5,
  table_size_max: 7,
  signup_closes_on: "2026-12-20",
  allow_back_to_back_hosting: false,
  bring_list_enabled: false,
};

describe("nextSeasonValues", () => {
  it("copies the format, how often, table size and settings, and starts after the ended season", () => {
    const next = nextSeasonValues(ended);
    const dated = { title: "", startsOn: "2027-05-01", endsOn: "2027-08-28", closesOn: "" };
    expect(next).toEqual({ ...valuesFromSeason(ended), ...dated });
    expect(next).toMatchObject({ format: "same_table_rotating", repeatKind: "monthly_weekday", weekOfMonth: "3", bringList: false });
  });

  it("keeps the number of months for a season set by months", () => {
    const next = nextSeasonValues({ ...ended, length_months: 4, repeat_kind: "weeks", repeat_weeks: 3 });
    expect(next).toMatchObject({ lengthMode: "months", lengthMonths: "4", repeatKind: "weeks", repeatWeeks: "3" });
  });
});
