// The reminder's event time in the org's wall clock. Pure, so the string the
// mail carries is unit-testable: the entry point only wires it in.

/** Whether this runtime's Intl can format in `zone`. */
export function intlKnowsTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone to format an org's reminders in. The database stores only names
 * it knows; the runtime's ICU can still lag a newly added IANA zone, and a
 * stored name it cannot format must not stop the org's sends, so it falls
 * back to UTC — the caller logs the fallback.
 */
export function reminderTimeZone(stored: string): string {
  return intlKnowsTimeZone(stored) ? stored : "UTC";
}

/** "Tuesday, September 29 at 7:00 PM" for the instant, in `timeZone`. */
export function formatReminderDate(startIso: string, timeZone: string): string {
  return new Date(startIso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
