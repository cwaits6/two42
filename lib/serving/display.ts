import { displayName, initials } from "@/lib/names";

interface PersonNameParts {
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
  email?: string | null;
}

function hasName(p: PersonNameParts): boolean {
  return [p.preferred_name, p.first_name, p.last_name].some((part) => part?.trim());
}

/**
 * A person's name, or their email when no name is on file yet — someone who
 * signed in but never filled in a profile still has to be recognisable on a
 * roster or a schedule.
 */
export function personName(p: PersonNameParts): string {
  return hasName(p) ? displayName(p) : p.email?.trim() || "No name on file";
}

/** Avatar initials, from the email when there is no name. */
export function personInitials(p: PersonNameParts): string {
  return hasName(p) ? initials(p) : (p.email?.trim().charAt(0).toUpperCase() || "?");
}

/**
 * Display name for a serving signup. A couple serving together shows as
 * their household ("The Smiths"); a single attendee shows individually
 * ("Danny Smith"). Falls back to joined names when a couple has no
 * household name on file.
 */
export function signupDisplayName(
  attendees: PersonNameParts[],
  familyName: string | null
): string {
  if (attendees.length === 0) return "Someone";
  if (attendees.length === 1) return personName(attendees[0]);
  if (familyName) return familyName;
  return attendees.map(personName).join(" & ");
}
