// Recipient filters for the serving reminder emails. Someone moved back to
// pending keeps their serving_signup_attendees and team_members rows but has
// lost the team, so both filters drop them.

export interface ServingProfile {
  email: string | null;
  role: string;
}

/** Next-Sunday reminder: an attendee with an email who is not pending. */
export function isServingReminderRecipient<P extends ServingProfile>(
  p: P | null | undefined,
): p is P & { email: string } {
  return !!p?.email && p.role !== "pending";
}

/** Open-dates broadcast: a team member who also has not opted out of announcements. */
export function isOpenDatesRecipient<P extends ServingProfile & { email_announcements: boolean }>(
  p: P | null | undefined,
): p is P & { email: string } {
  return isServingReminderRecipient(p) && p.email_announcements !== false;
}
