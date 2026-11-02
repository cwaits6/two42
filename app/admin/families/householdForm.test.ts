import { describe, expect, it } from "vitest";
import { validateHousehold, type HouseholdFormState } from "./householdForm";

const form = (overrides: Partial<HouseholdFormState> = {}): HouseholdFormState => ({
  family_name: "the okafor family",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  phone_home: "",
  phone_profile_id: null,
  anniversary_month: "",
  anniversary_day: "",
  anniversary_year: "",
  ...overrides,
});

describe("validateHousehold", () => {
  it("accepts a household with only a name, leaving the rest empty", () => {
    const { errors, payload } = validateHousehold(form());
    expect(errors).toEqual({});
    expect(payload).toMatchObject({ state: null, postal_code: null, phone_home: null, anniversary_month: null });
    expect(payload.family_name).toBeTruthy();
  });

  it("says what to enter against each field, without the word invalid", () => {
    const { errors } = validateHousehold(
      form({ family_name: "  ", state: "ZZ", postal_code: "12", phone_home: "1" }),
    );
    expect(errors).toEqual({
      family_name: "Enter a household name.",
      state: "Enter a state, like TX.",
      postal_code: "Enter a ZIP code, like 78701.",
      phone_home: "Enter a 10-digit phone number.",
    });
  });

  it("normalizes what it accepts", () => {
    const { errors, payload } = validateHousehold(
      form({ state: "tx", postal_code: "787011234", phone_home: "(512) 555-0134" }),
    );
    expect(errors).toEqual({});
    expect(payload).toMatchObject({ state: "TX", postal_code: "78701-1234", phone_home: "+15125550134" });
  });

  it("takes an anniversary with no year, and refuses a month with no day", () => {
    const yearless = validateHousehold(form({ anniversary_month: "10", anniversary_day: "3" }));
    expect(yearless.errors).toEqual({});
    expect(yearless.payload).toMatchObject({
      anniversary_month: 10,
      anniversary_day: 3,
      anniversary_year: null,
    });
    expect(validateHousehold(form({ anniversary_month: "10" })).errors).toEqual({
      anniversary_day: "Enter the day of the anniversary.",
    });
  });

  it("writes no hide setting, and keeps or clears the phone choice it was given", () => {
    const { payload } = validateHousehold(form({ phone_profile_id: "chloe" }));
    expect(payload.phone_profile_id).toBe("chloe");
    expect(Object.keys(payload).filter((key) => key.startsWith("hide_"))).toEqual([]);
    expect(validateHousehold(form()).payload.phone_profile_id).toBeNull();
  });
});
