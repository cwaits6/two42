import { describe, expect, it } from "vitest";
import {
  methodHref,
  parseGiveAmount,
  PAYMENT_METHODS,
  venmoPayHref,
} from "@/lib/giving/methods";

describe("venmoPayHref", () => {
  it("builds the payment link on the bare handle path", () => {
    expect(venmoPayHref("gracechurch", "Missions", "25.00")).toBe(
      "https://venmo.com/gracechurch?txn=pay&amount=25.00&note=Missions"
    );
  });

  it("builds the same link with or without a leading @", () => {
    expect(venmoPayHref("@gracechurch", "Missions", "25.00")).toBe(
      venmoPayHref("gracechurch", "Missions", "25.00")
    );
    expect(venmoPayHref("  @gracechurch ", "Missions", null)).toBe(
      venmoPayHref("gracechurch", "Missions", null)
    );
  });

  it("leaves the amount out when none is given", () => {
    const href = venmoPayHref("gracechurch", "Missions", null);
    expect(href).toBe("https://venmo.com/gracechurch?txn=pay&note=Missions");
    expect(new URL(href).searchParams.has("amount")).toBe(false);
  });

  it.each([
    ["Building Fund", "Building%20Fund"],
    ["Meals & Care", "Meals%20%26%20Care"],
    ["Youth trip 🚌", "Youth%20trip%20%F0%9F%9A%8C"],
    ["A+B=C?", "A%2BB%3DC%3F"],
  ])("keeps the note %j intact", (note, encoded) => {
    const href = venmoPayHref("gracechurch", note, "10.00");
    expect(href).toContain(`note=${encoded}`);
    expect(new URL(href).searchParams.get("note")).toBe(note);
    expect(decodeURIComponent(href.split("note=")[1])).toBe(note);
    expect(new URL(href).searchParams.get("amount")).toBe("10.00");
  });

  it("escapes characters in the handle", () => {
    expect(venmoPayHref("a/b?c", "Missions", null)).toBe(
      "https://venmo.com/a%2Fb%3Fc?txn=pay&note=Missions"
    );
  });
});

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
    [" 12.34 ", "12.34"],
  ])("formats %j as %j", (input, amount) => {
    expect(parseGiveAmount(input)).toEqual({ ok: true, amount });
  });

  it.each(["0", "0.00", "$0", ".0"])("refuses zero (%j)", (input) => {
    expect(parseGiveAmount(input)).toEqual({
      ok: false,
      error: "Enter an amount more than $0.",
    });
  });

  it.each(["-5", "25.123", "abc", "25.5.5", "1e3", ".", "$", "25 dollars"])(
    "refuses %j",
    (input) => {
      expect(parseGiveAmount(input)).toEqual({
        ok: false,
        error: "Enter dollars and cents, like 25 or 25.50.",
      });
    }
  );
});
