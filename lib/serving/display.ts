import { displayName, initials } from "@/lib/names";

interface PersonNameParts {
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
}

function hasName(p: PersonNameParts): boolean {
  return [p.preferred_name, p.first_name, p.last_name].some((part) => part?.trim());
}

function firstOf(p: PersonNameParts): string {
  return p.preferred_name?.trim() || p.first_name?.trim() || "";
}

const NO_NAME = "No name on file";

/**
 * A person's name. Never their email: a name is shown to whoever sees the
 * roster, schedule or message it lands in, and the person may hide their
 * address from those readers.
 */
export function personName(p: PersonNameParts): string {
  return hasName(p) ? displayName(p) : NO_NAME;
}

/**
 * A person's name, or their email when no name is on file. Only for a reader
 * who may see the address whether or not it is hidden: the person themselves
 * or a church admin.
 */
export function personNameOrEmail(p: PersonNameParts & { email: string | null }): string {
  return hasName(p) ? displayName(p) : p.email?.trim() || NO_NAME;
}

/** The name a spouse is called by in "Me & Ben": the first name, or the whole name when there is none. */
export function spouseFirstName(p: PersonNameParts): string {
  return firstOf(p) || personName(p);
}

export function personInitials(p: PersonNameParts): string {
  return hasName(p) ? initials(p) : "?";
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
