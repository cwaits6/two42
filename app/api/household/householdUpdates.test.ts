import { describe, expect, it } from "vitest";
import { householdFieldErrors, householdUpdates } from "./householdUpdates";

const me = "me-id";
const updatesFrom = (body: Record<string, unknown>) => {
  const result = householdUpdates(body, me);
  if ("error" in result) throw new Error(result.error);
  return result.updates;
};

describe("householdUpdates", () => {
  it("clears what a spouse blanks", () => {
    expect(
      updatesFrom({
        address_line1: "",
        city: "",
        phone_home: "",
        anniversary_month: "",
        anniversary_day: "",
        anniversary_year: "",
      }),
    ).toEqual({
      address_line1: null,
      city: null,
      phone_home: null,
      anniversary_month: null,
      anniversary_day: null,
      anniversary_year: null,
    });
  });

  it("ignores the retired hide settings and the single date", () => {
    expect(
      updatesFrom({ hide_address: true, hide_phone_home: true, anniversary: "2009-10-03", city: "Austin" }),
    ).toEqual({ city: "Austin" });
  });

  it("refuses a month with no day, and writes the parts together", () => {
    expect(householdUpdates({ anniversary_month: "10" }, me)).toEqual({
      error: "Enter the day of the anniversary.",
      status: 400,
    });
    expect(updatesFrom({ anniversary_month: "10", anniversary_day: "3" })).toEqual({
      anniversary_month: 10,
      anniversary_day: 3,
      anniversary_year: null,
    });
  });

  it("lets a spouse choose only their own number", () => {
    expect(householdUpdates({ phone_profile_id: "someone-else" }, me)).toEqual({
      error: "Only that spouse can choose their own number.",
      status: 403,
    });
    expect(updatesFrom({ phone_profile_id: me })).toEqual({ phone_profile_id: me, phone_home: null });
  });

  it("lets either spouse clear the choice", () => {
    expect(updatesFrom({ phone_profile_id: null })).toEqual({ phone_profile_id: null });
  });

  it("replaces a choice with a typed number, but leaves it alone for a blank one", () => {
    expect(updatesFrom({ phone_home: "(512) 555-0134" })).toEqual({
      phone_home: "+15125550134",
      phone_profile_id: null,
    });
    expect(updatesFrom({ phone_home: "" })).toEqual({ phone_home: null });
  });

  it("refuses a number that isn't one", () => {
    expect(householdUpdates({ phone_home: "12" }, me)).toEqual({
      error: "Enter a valid phone number.",
      status: 400,
    });
  });

  it("refuses with the first message the form would show", () => {
    const body = { family_name: " ", state: "ZZ", postal_code: "12" };
    expect(householdUpdates(body, me)).toEqual({
      error: Object.values(householdFieldErrors(body))[0],
      status: 400,
    });
  });
});

describe("householdFieldErrors", () => {
  it("names each invalid field, in the form's order", () => {
    expect(
      householdFieldErrors({
        anniversary_month: "10",
        phone_home: "12",
        postal_code: "12",
        state: "ZZ",
        family_name: " ",
      }),
    ).toEqual({
      family_name: "Enter a household name.",
      state: "Enter a 2-letter state, like TX.",
      postal_code: "Enter a 5-digit ZIP code, or ZIP+4.",
      phone_home: "Enter a valid phone number.",
      anniversary_day: "Enter the day of the anniversary.",
    });
    expect(
      Object.keys(householdFieldErrors({ anniversary_month: "10", postal_code: "12", family_name: "" })),
    ).toEqual(["family_name", "postal_code", "anniversary_day"]);
  });

  it("accepts blanks, and a body that leaves fields out", () => {
    expect(
      householdFieldErrors({
        family_name: "Okafor",
        state: "",
        postal_code: "",
        phone_home: "",
        anniversary_month: "",
        anniversary_day: "",
        anniversary_year: "",
      }),
    ).toEqual({});
    expect(householdFieldErrors({ city: "Austin" })).toEqual({});
  });

  it("does not judge a typed number a spouse's own number replaces", () => {
    expect(householdFieldErrors({ phone_home: "12", phone_profile_id: "me-id" })).toEqual({});
  });
});
