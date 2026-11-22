import type { PaymentMethodKey } from "@/lib/types";

/**
 * Payment method metadata for the Give page.
 *
 * Three kinds: "pay" (Venmo) opens a payment for the fund, with the amount
 * when one is given; "link" methods (PayPal, Cash App) deep-link straight into
 * the payer's app; "copy" methods (Zelle, Apple/Google Pay) have no public
 * profile URLs, so the handle is copied to the clipboard instead.
 *
 * Names and words only: no company logos or brand colors.
 */
export interface PaymentMethodMeta {
  key: PaymentMethodKey;
  name: string;
  kind: "pay" | "link" | "copy";
  verb: string;
  /** Shown before the handle for context, e.g. "paypal.me/" */
  prefix: string;
  placeholder: string;
}

export const PAYMENT_METHODS: Record<PaymentMethodKey, PaymentMethodMeta> = {
  venmo: {
    key: "venmo",
    name: "Venmo",
    kind: "pay",
    verb: "Open Venmo",
    prefix: "",
    placeholder: "@your-venmo",
  },
  paypal: {
    key: "paypal",
    name: "PayPal",
    kind: "link",
    verb: "Open PayPal",
    prefix: "paypal.me/",
    placeholder: "yourpaypalme",
  },
  cashapp: {
    key: "cashapp",
    name: "Cash App",
    kind: "link",
    verb: "Open Cash App",
    prefix: "",
    placeholder: "$yourcashtag",
  },
  zelle: {
    key: "zelle",
    name: "Zelle",
    kind: "copy",
    verb: "Tap to copy",
    prefix: "",
    placeholder: "email or phone",
  },
  wallet: {
    key: "wallet",
    name: "Apple / Google Pay",
    kind: "copy",
    verb: "Tap to copy",
    prefix: "",
    placeholder: "phone number",
  },
};

export const METHOD_ORDER: PaymentMethodKey[] = [
  "venmo",
  "paypal",
  "cashapp",
  "zelle",
  "wallet",
];

/**
 * External deep link for the "link" methods; undefined for the others.
 */
export function methodHref(
  key: PaymentMethodKey,
  handle: string
): string | undefined {
  switch (key) {
    case "paypal":
      return `https://paypal.me/${encodeURIComponent(handle.replace(/^paypal\.me\//i, ""))}`;
    case "cashapp":
      return `https://cash.app/${encodeURIComponent(handle.startsWith("$") ? handle : "$" + handle)}`;
    default:
      return undefined;
  }
}

/**
 * Venmo's app link: opens the payment in the installed app directly. A phone
 * uses it because a venmo.com link opened in the browser can stop short of
 * the app. `amount` must come from parseGiveAmount.
 */
export function venmoAppHref(handle: string, note: string, amount: string | null): string {
  const params = new URLSearchParams({
    txn: "pay",
    recipients: handle.trim().replace(/^@/, ""),
  });
  if (amount) params.set("amount", amount);
  params.set("note", note);
  return `venmo://paycharge?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Venmo's web payment page, for a phone without the app: it stays in the
 * browser, asks the person to sign in, and keeps the recipient, amount and
 * note through sign-in. `amount` must come from parseGiveAmount.
 */
export function venmoWebPayHref(handle: string, note: string, amount: string | null): string {
  const params = new URLSearchParams({ recipients: handle.trim().replace(/^@/, "") });
  if (amount) params.set("amount", amount);
  params.set("note", note);
  return `https://account.venmo.com/pay?${params.toString().replace(/\+/g, "%20")}`;
}

export type GiveAmount =
  | { ok: true; amount: string | null }
  | { ok: false; error: string };

const DOLLARS_AND_CENTS = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;
// Commas only as thousands separators: "25,50" is refused, not read as 2550.
const GROUPED_THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
// Far above any real gift, and far below where toFixed switches to "1e+21".
const MAX_AMOUNT = 1_000_000;

/**
 * Check an optional amount typed on Give. Blank means "no amount"; otherwise
 * dollars and cents above zero, returned as a fixed two-decimal string.
 */
export function parseGiveAmount(input: string): GiveAmount {
  if (input.trim() === "") return { ok: true, amount: null };
  const bare = input.trim().replace(/^\$\s*/, "");
  const typed = GROUPED_THOUSANDS.test(bare) ? bare.replace(/,/g, "") : bare;
  if (!DOLLARS_AND_CENTS.test(typed)) {
    return { ok: false, error: "Enter dollars and cents, like 25 or 25.50." };
  }
  const value = Number(typed);
  if (value <= 0) return { ok: false, error: "Enter an amount more than $0." };
  if (value > MAX_AMOUNT) return { ok: false, error: "Enter an amount up to $1,000,000." };
  return { ok: true, amount: value.toFixed(2) };
}

/** A fund method with its handle */
export interface ResolvedMethod {
  method: PaymentMethodKey;
  handle: string;
  meta: PaymentMethodMeta;
}

/**
 * Resolve a fund's methods, dropping any without a handle —
 * a method with nothing to show is a dead button.
 */
export function resolveFundMethods(
  fundMethods: { method: PaymentMethodKey; custom_handle: string; display_order: number }[]
): ResolvedMethod[] {
  return fundMethods
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .flatMap((fm) => {
      if (!fm.custom_handle) return [];
      return [{ method: fm.method, handle: fm.custom_handle, meta: PAYMENT_METHODS[fm.method] }];
    });
}
