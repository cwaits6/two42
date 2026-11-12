import { describe, expect, it } from "vitest";
import { retiredFlagResets } from "./retiredHideFlags";

describe("retiredFlagResets", () => {
  it("resets the flag when a new value replaces the hidden one", () => {
    expect(retiredFlagResets({ phone_mobile: "+15125550100" }, { phone_mobile: "+15125550199" })).toEqual({
      hide_phone_mobile: false,
    });
  });

  it("resets the flag when a value is entered where there was none", () => {
    expect(retiredFlagResets({ occupation: null, employer: null }, { occupation: "Teacher", employer: null })).toEqual({
      hide_occupation: false,
    });
  });

  it("leaves the flag on an unchanged or cleared value, so the hidden value is still deleted", () => {
    expect(retiredFlagResets({ phone_mobile: "+15125550100" }, { phone_mobile: "+15125550100" })).toEqual({});
    expect(retiredFlagResets({ phone_mobile: "+15125550100" }, { phone_mobile: null })).toEqual({});
  });

  it("leaves the flag when part of what it hid stays, so saving can't show it", () => {
    const previous = { address_line1: "1 Main St", city: "Austin", state: "TX", postal_code: "78701" };
    expect(retiredFlagResets(previous, { ...previous, city: "Dallas" })).toEqual({});
    expect(retiredFlagResets({ birth_month: 3, birth_day: 5 }, { birth_month: 4, birth_day: 5 })).toEqual({});
  });

  it("resets the flag when every part it hid is replaced or cleared", () => {
    expect(
      retiredFlagResets(
        { address_line1: "1 Main St", address_line2: "Apt 2", city: "Austin" },
        { address_line1: "9 Oak Ave", address_line2: null, city: "Dallas" },
      ),
    ).toEqual({ hide_address: false });
  });

  it("treats a field missing from a partial write as unchanged", () => {
    expect(retiredFlagResets({ address_line1: "1 Main St", city: "Austin" }, { city: "Dallas" })).toEqual({});
    expect(retiredFlagResets({ phone_mobile: "+15125550100" }, {})).toEqual({});
  });
});
