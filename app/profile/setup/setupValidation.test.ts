import { describe, expect, it } from "vitest";
import { aboutYouErrors, contactErrors, householdErrors, personErrors } from "./setupValidation";

const aboutYou = { firstName: "Ada", lastName: "Lovelace", preferredName: "", birthMonth: "", birthDay: "", birthYear: "" };
const contact = { phoneMobile: "", phoneHome: "", phoneWork: "" };

describe("aboutYouErrors", () => {
  it("lets setup continue without a birthday", () => {
    expect(aboutYouErrors(aboutYou)).toEqual({});
  });

  it("asks for each missing name, then a half-filled birthday, in field order", () => {
    expect(Object.keys(aboutYouErrors({ ...aboutYou, firstName: " ", lastName: "", birthMonth: "3" }))).toEqual([
      "first_name",
      "last_name",
      "birth_day",
    ]);
  });

  it("refuses a name over 100 characters, the optional preferred name included", () => {
    const long = "a".repeat(101);
    expect(aboutYouErrors({ ...aboutYou, lastName: long, preferredName: long })).toEqual({
      last_name: "Use 100 characters or fewer.",
      preferred_name: "Use 100 characters or fewer.",
    });
  });
});

describe("contactErrors", () => {
  it("lets setup continue with no phone number", () => {
    expect(contactErrors(contact)).toEqual({});
  });

  it("marks a phone number that isn't one", () => {
    expect(contactErrors({ ...contact, phoneWork: "12" })).toEqual({ phone_work: "Enter a valid phone number." });
  });
});

describe("householdErrors", () => {
  it("asks for a household until one is chosen", () => {
    expect(householdErrors(false)).toEqual({ household: "Find your household, or add a new one." });
    expect(householdErrors(true)).toEqual({});
  });

  it("checks the anniversary only while a spouse is being added", () => {
    const monthOnly = { month: "10", day: "", year: "" };
    expect(householdErrors(true, monthOnly)).toEqual({
      anniversary_day: "Enter the day of the anniversary.",
    });
    expect(householdErrors(true, { month: "10", day: "3", year: "" })).toEqual({});
    expect(householdErrors(true)).toEqual({});
  });
});

describe("personErrors", () => {
  it("needs only a first name", () => {
    expect(personErrors({ first_name: "Lily", last_name: "", birth_month: "", birth_day: "", birth_year: "" })).toEqual({});
  });

  it("refuses an added person's name over 100 characters on its field", () => {
    const long = "a".repeat(101);
    expect(personErrors({ first_name: long, last_name: long, birth_month: "", birth_day: "", birth_year: "" })).toEqual({
      add_first_name: "Use 100 characters or fewer.",
      add_last_name: "Use 100 characters or fewer.",
    });
  });

  it("marks the add form's own fields", () => {
    expect(personErrors({ first_name: "", last_name: "", birth_month: "2", birth_day: "31", birth_year: "" })).toEqual({
      add_first_name: "Enter a first name.",
      add_birth_day: "Enter a day from 1 to 29.",
    });
  });
});
