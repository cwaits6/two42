import { METHOD_ORDER, PAYMENT_METHODS } from "@/lib/giving/methods";
import type { PaymentMethodKey } from "@/lib/types";

/** "Jun 20, 2027" for a stored "YYYY-MM-DD", read as the calendar date it is. */
export function formatFundDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The tag on a fund with a last day. */
export function fundThroughTag(retireOn: string | null): string | null {
  return retireOn ? `Through ${formatFundDate(retireOn)}` : null;
}

/** "Goes to Linda & Ray Park · Treasurer" */
export function fundRecipientLine(names: string, role: string | null): string {
  return `Goes to ${names}${role ? ` · ${role}` : ""}`;
}

/**
 * A fund past its last day stays active in the database and stops being
 * offered, so both cases read as retired. `today` is in the church's zone.
 */
export function fundStatus(
  fund: { is_active: boolean; retire_on: string | null },
  today: string
): { text: string; live: boolean } {
  if (!fund.is_active) return { text: "Retired", live: false };
  if (fund.retire_on && fund.retire_on < today) {
    return { text: `Retired ${formatFundDate(fund.retire_on)}`, live: false };
  }
  return { text: "Live", live: true };
}

export const FUND_NAME_FIELD = "fund-name";

export function methodAccountField(key: PaymentMethodKey): string {
  return `fund-method-${key}`;
}

export function methodToggleField(key: PaymentMethodKey): string {
  return `fund-method-${key}-on`;
}

/** The "turn on at least one" message sits on the first toggle. */
export const METHODS_FIELD = methodToggleField(METHOD_ORDER[0]);

export type FundMethodInput = Record<PaymentMethodKey, { enabled: boolean; custom: string }>;

/** Messages keyed by the id of the control they belong to, in page order. */
export function fundFieldErrors(name: string, methods: FundMethodInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!name.trim()) errors[FUND_NAME_FIELD] = "Enter a fund name.";
  const enabled = METHOD_ORDER.filter((key) => methods[key].enabled);
  if (enabled.length === 0) {
    errors[METHODS_FIELD] = "Turn on at least one payment method.";
  }
  for (const key of enabled) {
    if (!methods[key].custom.trim()) {
      const method = PAYMENT_METHODS[key].name;
      errors[methodAccountField(key)] = `Enter the ${method} account, or turn ${method} off.`;
    }
  }
  return errors;
}
