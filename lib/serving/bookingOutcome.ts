/**
 * What a booking ended with and how the sign-up screens say it. Free of
 * server imports, so the dialog and the link page can share it.
 */

export interface BookedDate {
  date: string;
  signupId: string;
  created: boolean;
}

export interface BookingOutcome {
  booked: BookedDate[];
  /** The first following date that could not be booked, and why. */
  stopped: { date: string; reason: "taken" | "failed" } | null;
}

export function bookingMessage(outcome: BookingOutcome, format: (date: string) => string): string {
  const dates = outcome.booked.map((b) => format(b.date));
  const list = dates.length <= 1 ? dates.join("") : `${dates.slice(0, -1).join(", ")} and ${dates.at(-1)}`;
  const first = `You're signed up for ${list}.`;
  if (!outcome.stopped) return first;
  const when = format(outcome.stopped.date);
  return outcome.stopped.reason === "taken"
    ? `${first} ${when} was just taken.`
    : `${first} ${when} couldn't be booked.`;
}
