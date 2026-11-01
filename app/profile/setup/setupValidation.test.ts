import { describe, expect, it } from "vitest";
import { aboutYouErrors, contactErrors, householdErrors, personErrors } from "./setupValidation";

const aboutYou = { firstName: "Ada", lastName: "Lovelace", birthMonth: "", birthDay: "", birthYear: "" };
const contact = {
  phoneMobile: "",
  phoneHome: "",
  phoneWork: "",
  email: "ada@example.com",
  hidePhoneMobile: false,
  hidePhoneHome: false,
  hidePhoneWork: false,
  hideEmail: false,
};

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
});

describe("contactErrors", () => {
  it("accepts a visible email with no phone", () => {
    expect(contactErrors(contact)).toEqual({});
  });

  it("asks for a way to be reached when the only mobile and the email are hidden", () => {
    expect(contactErrors({ ...contact, phoneMobile: "(214) 867-5309", hidePhoneMobile: true, hideEmail: true })).toEqual({
      phone_mobile: "Add a phone number, or keep your email visible so people can reach you.",
    });
  });

  it("accepts a home phone when the email is hidden", () => {
    expect(contactErrors({ ...contact, phoneHome: "(214) 867-5309", hideEmail: true })).toEqual({});
  });

  it("doesn't count a hidden home phone, or an email it doesn't have", () => {
    expect(contactErrors({ ...contact, phoneHome: "(214) 867-5309", hidePhoneHome: true, hideEmail: true })).toEqual({
      phone_mobile: "Add a phone number, or keep your email visible so people can reach you.",
    });
    expect(contactErrors({ ...contact, email: "" })).toEqual({
      phone_mobile: "Add a phone number, or keep your email visible so people can reach you.",
    });
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
});

describe("personErrors", () => {
  it("needs only a first name", () => {
    expect(personErrors({ first_name: "Lily", last_name: "", birth_month: "", birth_day: "", birth_year: "" })).toEqual({});
  });

  it("marks the add form's own fields", () => {
    expect(personErrors({ first_name: "", last_name: "", birth_month: "2", birth_day: "31", birth_year: "" })).toEqual({
      add_first_name: "Enter a first name.",
      add_birth_day: "Enter a day from 1 to 29.",
    });
  });
});
