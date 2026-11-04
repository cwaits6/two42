/**
 * Booking one date and the following weeks a team asks for, shared by the
 * in-app signup API and the signed email-link API. Each date is one row, so
 * the chosen date is booked first and stands on its own when a later one
 * turns out to be taken.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "@/lib/names";
import type { BookedDate, BookingOutcome } from "@/lib/serving/bookingOutcome";
import { sendSignupConfirmation, type NamedProfile } from "@/lib/serving/server";

export type { BookedDate, BookingOutcome } from "@/lib/serving/bookingOutcome";

/** Books one date: the row and whether it was new, or the RPC's error code. */
export type BookDate = (date: string) => Promise<{ signupId: string; created: boolean } | { code: string }>;

export async function bookDates(
  dates: string[],
  book: BookDate
): Promise<BookingOutcome | { code: string }> {
  const [first, ...following] = dates;
  const main = await book(first);
  if ("code" in main) return main;
  const booked: BookedDate[] = [{ date: first, ...main }];
  for (const date of following) {
    const next = await book(date);
    if ("code" in next) {
      return { booked, stopped: { date, reason: next.code === "SV001" ? "taken" : "failed" } };
    }
    booked.push({ date, ...next });
  }
  return { booked, stopped: null };
}

/**
 * Confirms every newly booked date to every attendee with an email, so both
 * spouses get the message and the calendar invite. Never throws: an email
 * failure must not undo a booking that is already in place.
 */
export async function sendBookingConfirmations(
  supabase: SupabaseClient,
  opts: {
    orgId: string;
    groupId: string;
    teamId: string;
    teamName: string;
    booked: BookedDate[];
    attendees: Array<NamedProfile & { email: string | null }>;
  }
): Promise<void> {
  for (const { date, signupId, created } of opts.booked) {
    // A re-signup of a date already held is not a new booking, and a second
    // confirmation would read as a double booking.
    if (!created) continue;
    for (const attendee of opts.attendees) {
      if (!attendee.email) continue;
      try {
        await sendSignupConfirmation(supabase, {
          signupId,
          orgId: opts.orgId,
          groupId: opts.groupId,
          teamId: opts.teamId,
          teamName: opts.teamName,
          serviceDate: date,
          attendees: opts.attendees,
          recipient: { id: attendee.id, email: attendee.email, name: displayName(attendee) },
        });
      } catch (err) {
        console.error("Serving confirmation email failed for %s:", attendee.id, err);
      }
    }
  }
}
