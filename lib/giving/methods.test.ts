import { describe, expect, it } from "vitest";
import {
  methodHref,
  parseGiveAmount,
  PAYMENT_METHODS,
  venmoAppHref,
  venmoWebPayHref,
} from "@/lib/giving/methods";

describe("methodHref", () => {
  it("keeps the PayPal and Cash App links", () => {
    expect(methodHref("paypal", "paypal.me/grace")).toBe("https://paypal.me/grace");
    expect(methodHref("cashapp", "grace")).toBe("https://cash.app/%24grace");
  });

  it("has no link for copy methods", () => {
    expect(methodHref("zelle", "grace@example.com")).toBeUndefined();
  });

  it("has a link for exactly the methods whose card renders one", () => {
    for (const meta of Object.values(PAYMENT_METHODS)) {
      expect(methodHref(meta.key, "grace") !== undefined, meta.key).toBe(
        meta.kind === "link"
      );
    }
  });
});

describe("parseGiveAmount", () => {
  it("treats a blank amount as no amount", () => {
    expect(parseGiveAmount("")).toEqual({ ok: true, amount: null });
    expect(parseGiveAmount("   ")).toEqual({ ok: true, amount: null });
  });

  it.each([
    ["25", "25.00"],
    ["25.5", "25.50"],
    ["25.50", "25.50"],
    ["25.", "25.00"],
    [".5", "0.50"],
    ["0.01", "0.01"],
    ["007", "7.00"],
    ["$25", "25.00"],
    ["$ 25", "25.00"],
    ["1,000", "1000.00"],
    ["$1,250.50", "1250.50"],
    [" 12.34 ", "12.34"],
    ["1,000,000", "1000000.00"],
  ])("formats %j as %j", (input, amount) => {
    expect(parseGiveAmount(input)).toEqual({ ok: true, amount });
  });

  it.each(["0", "0.00", "$0", ".0"])("refuses zero (%j)", (input) => {
    expect(parseGiveAmount(input)).toEqual({
      ok: false,
      error: "Enter an amount more than $0.",
    });
  });

  it.each(["1000000.01", "1,000,001", "1000000000000000000000", "9".repeat(400)])(
    "refuses an amount over the cap (%j)",
    (input) => {
      expect(parseGiveAmount(input)).toEqual({
        ok: false,
        error: "Enter an amount up to $1,000,000.",
      });
    }
  );

  it.each(["-5", "25.123", "abc", "25.5.5", "1e3", ".", "$", "25 dollars", "25,50", "1,00", ",100"])(
    "refuses %j",
    (input) => {
      expect(parseGiveAmount(input)).toEqual({
        ok: false,
        error: "Enter dollars and cents, like 25 or 25.50.",
      });
    }
  );
});

describe("venmoAppHref", () => {
  it("opens a payment in the app with the recipient, amount and note", () => {
    expect(venmoAppHref("@gracechurch", "Meals & Care", "25.00")).toBe(
      "venmo://paycharge?txn=pay&recipients=gracechurch&amount=25.00&note=Meals%20%26%20Care"
    );
  });

  it("leaves the amount out when none is given", () => {
    expect(venmoAppHref(" gracechurch ", "Missions", null)).toBe(
      "venmo://paycharge?txn=pay&recipients=gracechurch&note=Missions"
    );
  });

  it("keeps a typed plus sign distinct from a space", () => {
    const href = venmoAppHref("gracechurch", "A+B C", null);
    expect(href.endsWith("note=A%2BB%20C")).toBe(true);
  });
});

describe("venmoWebPayHref", () => {
  it("builds the same link with or without a leading @", () => {
    expect(venmoWebPayHref("  @gracechurch ", "Missions", null)).toBe(
      venmoWebPayHref("gracechurch", "Missions", null)
    );
  });

  it.each([
    ["Building Fund", "Building%20Fund"],
    ["Meals & Care", "Meals%20%26%20Care"],
    ["Youth trip 🚌", "Youth%20trip%20%F0%9F%9A%8C"],
    ["A+B=C?", "A%2BB%3DC%3F"],
  ])("keeps the note %j intact", (note, encoded) => {
    const href = venmoWebPayHref("gracechurch", note, "10.00");
    expect(href).toContain(`note=${encoded}`);
    expect(new URL(href).searchParams.get("note")).toBe(note);
    expect(new URL(href).searchParams.get("amount")).toBe("10.00");
  });

  it("keeps a handle with odd characters inside the recipients value", () => {
    const href = venmoWebPayHref("a/b?c&d", "Missions", null);
    expect(new URL(href).pathname).toBe("/pay");
    expect(new URL(href).searchParams.get("recipients")).toBe("a/b?c&d");
  });

  it("opens Venmo's web payment page with the recipient, amount and note", () => {
    expect(venmoWebPayHref("@gracechurch", "Meals & Care", "25.00")).toBe(
      "https://account.venmo.com/pay?recipients=gracechurch&amount=25.00&note=Meals%20%26%20Care"
    );
  });
});
