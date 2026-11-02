import { describe, expect, it } from "vitest";
import { anniversaryColumns, anniversaryErrors, birthdayColumns, birthdayErrors } from "./birthday";

const today = new Date(2026, 9, 31);
const errors = (month: string, day: string, year = "") =>
  birthdayErrors({ month, day, year }, today);

describe("birthdayErrors", () => {
  it("accepts a birthday left blank", () => {
    expect(errors("", "")).toEqual({});
  });

  it("accepts a month and day without a year", () => {
    expect(errors("2", "29")).toEqual({});
  });

  it("asks for the day when only the month is given", () => {
    expect(errors("5", "")).toEqual({ birth_day: "Enter the day of the birthday." });
  });

  it("asks for the month when only the day is given", () => {
    expect(errors("", "12")).toEqual({ birth_month: "Choose the month of the birthday." });
  });

  it("asks for the month and day when only the year is given", () => {
    expect(Object.keys(errors("", "", "1980"))).toEqual(["birth_month", "birth_day"]);
  });

  it("rejects a day the month does not have", () => {
    expect(errors("2", "30")).toEqual({ birth_day: "Enter a day from 1 to 29." });
    expect(errors("2", "29", "2023")).toEqual({ birth_day: "Enter a day from 1 to 28." });
  });

  it("rejects a year before 1900 or after this year", () => {
    expect(errors("1", "1", "1850").birth_year).toBe("Enter a year from 1900 to 2026, or leave it blank.");
    expect(errors("1", "1", "2027").birth_year).toBe("Enter a year from 1900 to 2026, or leave it blank.");
    expect(errors("1", "1", "2026")).toEqual({});
  });
});

describe("birthdayColumns", () => {
  it("stores blanks as null", () => {
    expect(birthdayColumns({ month: "", day: "", year: "" })).toEqual({
      birth_month: null,
      birth_day: null,
      birth_year: null,
    });
    expect(birthdayColumns({ month: "7", day: "4", year: "" })).toEqual({
      birth_month: 7,
      birth_day: 4,
      birth_year: null,
    });
  });
});

describe("anniversaryErrors", () => {
  const check = (month: string, day: string, year = "") => anniversaryErrors({ month, day, year }, today);

  it("accepts it blank, or with a month and day and no year", () => {
    expect(check("", "")).toEqual({});
    expect(check("2", "29")).toEqual({});
  });

  it("says what is missing in plain words", () => {
    expect(check("5", "")).toEqual({ anniversary_day: "Enter the day of the anniversary." });
    expect(check("", "12")).toEqual({ anniversary_month: "Choose the month of the anniversary." });
  });

  it("refuses a month that isn't one, and a day the year doesn't have", () => {
    expect(check("13", "1")).toEqual({ anniversary_month: "Choose the month of the anniversary." });
    expect(check("2", "29", "2023")).toEqual({ anniversary_day: "Enter a day from 1 to 28." });
  });

  it("stores blanks as null", () => {
    expect(anniversaryColumns({ month: "10", day: "3", year: "" })).toEqual({
      anniversary_month: 10,
      anniversary_day: 3,
      anniversary_year: null,
    });
    expect(anniversaryColumns({ month: "", day: "", year: "" })).toEqual({
      anniversary_month: null,
      anniversary_day: null,
      anniversary_year: null,
    });
  });
});
