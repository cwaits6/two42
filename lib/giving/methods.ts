import type { PaymentMethodKey } from "@/lib/types";

/**
 * Payment method metadata for the Give page.
 *
 * Two kinds: "link" methods (Venmo, PayPal, Cash App) deep-link straight into
 * the payer's app; "copy" methods (Zelle, Apple/Google Pay) have no public
 * profile URLs, so the handle is copied to the clipboard instead.
 *
 * Text chips only: no trademarked logos or brand colors.
 */
export interface PaymentMethodMeta {
  key: PaymentMethodKey;
  name: string;
  glyph: string;
  kind: "link" | "copy";
  verb: string;
  /** Shown before the handle for context, e.g. "paypal.me/" */
  prefix: string;
  placeholder: string;
}

export const PAYMENT_METHODS: Record<PaymentMethodKey, PaymentMethodMeta> = {
  venmo: {
    key: "venmo",
    name: "Venmo",
    glyph: "V",
    kind: "link",
    verb: "Open Venmo",
    prefix: "",
    placeholder: "@your-venmo",
  },
  paypal: {
    key: "paypal",
    name: "PayPal",
    glyph: "P",
    kind: "link",
    verb: "Open PayPal",
    prefix: "paypal.me/",
    placeholder: "yourpaypalme",
  },
  cashapp: {
    key: "cashapp",
    name: "Cash App",
    glyph: "$",
    kind: "link",
    verb: "Open Cash App",
    prefix: "",
    placeholder: "$yourcashtag",
  },
  zelle: {
    key: "zelle",
    name: "Zelle",
    glyph: "Z",
    kind: "copy",
    verb: "Tap to copy",
    prefix: "",
    placeholder: "email or phone",
  },
  wallet: {
    key: "wallet",
    name: "Apple / Google Pay",
    glyph: "◑",
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
 * External deep link for PayPal and Cash App; undefined for copy methods.
 * Venmo links carry the fund and amount, so they come from venmoPayHref.
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
 * Venmo's documented payment link (venmo.com/paymentlinks): opens a payment
 * to `handle` with the note, and the amount when one is given, filled in.
 * `amount` must come from parseGiveAmount.
 */
export function venmoPayHref(handle: string, note: string, amount: string | null): string {
  const params = new URLSearchParams({ txn: "pay" });
  if (amount) params.set("amount", amount);
  params.set("note", note);
  const recipient = encodeURIComponent(handle.trim().replace(/^@/, ""));
  // URLSearchParams writes a space as "+"; a literal "+" is already "%2B", so
  // every "+" left is a space, spelled %20 for apps that don't decode "+".
  return `https://venmo.com/${recipient}?${params.toString().replace(/\+/g, "%20")}`;
}

export type GiveAmount =
  | { ok: true; amount: string | null }
  | { ok: false; error: string };

const DOLLARS_AND_CENTS = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;

/**
 * Check an optional amount typed on Give. Blank means "no amount"; otherwise
 * dollars and cents above zero, returned as a fixed two-decimal string.
 */
export function parseGiveAmount(input: string): GiveAmount {
  if (input.trim() === "") return { ok: true, amount: null };
  const typed = input.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!DOLLARS_AND_CENTS.test(typed)) {
    return { ok: false, error: "Enter dollars and cents, like 25 or 25.50." };
  }
  const value = Number(typed);
  if (value <= 0) return { ok: false, error: "Enter an amount more than $0." };
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
