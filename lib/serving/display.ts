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

function firstOf(p: PersonNameParts): string {
  return p.preferred_name?.trim() || p.first_name?.trim() || "";
}

/**
 * A person's name, or their email when no name is on file yet — someone who
 * signed in but never filled in a profile still has to be recognisable on a
 * roster or a schedule.
 */
export function personName(p: PersonNameParts): string {
  return hasName(p) ? displayName(p) : p.email?.trim() || "No name on file";
}

/** The name a spouse is called by in "Me & Ben": the first name, or the whole name when there is none. */
export function spouseFirstName(p: PersonNameParts): string {
  return firstOf(p) || personName(p);
}

/** Avatar initials, from the email when there is no name. */
export function personInitials(p: PersonNameParts): string {
  return hasName(p) ? initials(p) : (p.email?.trim().charAt(0).toUpperCase() || "?");
}

/**
 * "David & Lena Reyes" when a couple shares a last name, "David Reyes & Lena
 * Cho" when they do not; the same shape as the directory's anniversaries.
 */
export function coupleName(a: PersonNameParts, b: PersonNameParts): string {
  const lastA = a.last_name?.trim() ?? "";
  const lastB = b.last_name?.trim() ?? "";
  const firstA = firstOf(a);
  const firstB = firstOf(b);
  if (firstA && firstB && lastA && lastA === lastB) return `${firstA} & ${firstB} ${lastA}`;
  return `${personName(a)} & ${personName(b)}`;
}

/** The name shown for a serving date: one person, or a couple by name. */
export function signupDisplayName(attendees: PersonNameParts[]): string {
  if (attendees.length === 0) return "Someone";
  if (attendees.length === 1) return personName(attendees[0]);
  if (attendees.length === 2) return coupleName(attendees[0], attendees[1]);
  return attendees.map(personName).join(" & ");
}

/** "You", "You & Ben", or the other names, for the viewer's own date. */
export function ownSignupLabel(attendees: Array<PersonNameParts & { id: string }>, viewerId: string): string {
  const others = attendees.filter((a) => a.id !== viewerId);
  if (others.length === 0) return "You";
  return attendees.some((a) => a.id === viewerId)
    ? `You & ${others.map(spouseFirstName).join(" & ")}`
    : signupDisplayName(others);
}
