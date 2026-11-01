import { describe, expect, it } from "vitest";
import {
  FUND_NAME_FIELD,
  METHODS_FIELD,
  formatFundDate,
  fundFieldErrors,
  fundRecipientLine,
  fundStatus,
  fundThroughTag,
  methodAccountField,
  reopenedFund,
  type FundMethodInput,
} from "@/lib/giving/funds";

const allOff: FundMethodInput = {
  venmo: { enabled: false, custom: "" },
  paypal: { enabled: false, custom: "" },
  cashapp: { enabled: false, custom: "" },
  zelle: { enabled: false, custom: "" },
  wallet: { enabled: false, custom: "" },
};

describe("formatFundDate", () => {
  it("writes the stored calendar date in words, whatever zone the server runs in", () => {
    expect(formatFundDate("2027-06-20")).toBe("Jun 20, 2027");
    expect(formatFundDate("2027-01-01")).toBe("Jan 1, 2027");
  });
});

describe("fundThroughTag", () => {
  it("has no tag without a last day", () => {
    expect(fundThroughTag(null)).toBeNull();
    expect(fundThroughTag("2027-06-20")).toBe("Through Jun 20, 2027");
  });
});

describe("fundRecipientLine", () => {
  it("names who the fund goes to, with their role when there is one", () => {
    expect(fundRecipientLine("Ray Park", null)).toBe("Goes to Ray Park");
    expect(fundRecipientLine("Linda & Ray Park", "Treasurer")).toBe(
      "Goes to Linda & Ray Park · Treasurer"
    );
  });
});

describe("fundStatus", () => {
  const today = "2026-11-01";

  it("is live through its last day", () => {
    expect(fundStatus({ is_active: true, retire_on: null }, today).live).toBe(true);
    expect(fundStatus({ is_active: true, retire_on: today }, today).live).toBe(true);
  });

  it("names the date once the last day has passed, never as a stored date", () => {
    expect(fundStatus({ is_active: true, retire_on: "2026-10-31" }, today)).toEqual({
      text: "Retired Oct 31, 2026",
      live: false,
    });
  });

  it("reads retired when someone retired it, whatever its date says", () => {
    expect(fundStatus({ is_active: false, retire_on: "2027-01-01" }, today)).toEqual({
      text: "Retired",
      live: false,
    });
  });
});

describe("reopenedFund", () => {
  const today = "2026-11-01";

  it("drops a last day that has passed, so the fund reads live afterward", () => {
    const reopened = reopenedFund("2026-10-31", today);
    expect(reopened).toEqual({ is_active: true, retire_on: null });
    expect(fundStatus(reopened, today).live).toBe(true);
  });

  it("keeps a last day still to come, including one that is today", () => {
    expect(reopenedFund("2027-01-01", today).retire_on).toBe("2027-01-01");
    expect(reopenedFund(today, today).retire_on).toBe(today);
    expect(reopenedFund(null, today).retire_on).toBeNull();
  });
});

describe("fundFieldErrors", () => {
  it("accepts a named fund with an account on every method that is on", () => {
    const methods = { ...allOff, venmo: { enabled: true, custom: "@fund" } };
    expect(fundFieldErrors("Building fund", methods)).toEqual({});
  });

  it("marks a blank name and no methods, in page order", () => {
    expect(Object.keys(fundFieldErrors("   ", allOff))).toEqual([FUND_NAME_FIELD, METHODS_FIELD]);
  });

  it("marks a method that is on with no account, even when another method is fine", () => {
    const methods = {
      ...allOff,
      venmo: { enabled: true, custom: "@fund" },
      zelle: { enabled: true, custom: "   " },
    };
    expect(fundFieldErrors("Building fund", methods)).toEqual({
      [methodAccountField("zelle")]: "Enter the Zelle account, or turn Zelle off.",
    });
  });

  it("ignores a blank account on a method that is off", () => {
    const methods = {
      ...allOff,
      venmo: { enabled: true, custom: "@fund" },
      paypal: { enabled: false, custom: "   " },
    };
    expect(fundFieldErrors("Building fund", methods)).toEqual({});
  });
});
