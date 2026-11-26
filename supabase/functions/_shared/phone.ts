// normalizePhone() from lib/sanitize.ts for the edge functions, over the same
// libphonenumber-js release as package-lock.json; bump both together.
// tests/phone_test.ts and lib/sanitize.phone-parity.test.ts hold both to
// phone-fixtures.ts, so a copied number is the one a member's save would store.
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1.13.17";

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format("E.164");
}
