// The reminder's event time in the org's wall clock. Pure, so the string the
// mail carries is unit-testable: the entry point only wires it in.

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
