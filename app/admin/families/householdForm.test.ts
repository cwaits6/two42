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
  anniversary: "",
  hide_address: false,
  hide_phone_home: false,
  ...overrides,
});

describe("validateHousehold", () => {
  it("accepts a household with only a name, leaving the rest empty", () => {
    const { errors, payload } = validateHousehold(form());
    expect(errors).toEqual({});
    expect(payload).toMatchObject({ state: null, postal_code: null, phone_home: null, anniversary: null });
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
});
