/**
 * Name display helpers. The canonical name on a profile is first + last, then
 * the suffix — there is no stored `full_name` column. Any display of a
 * member's name should go through these helpers so formatting stays
 * consistent.
 */

export interface NameParts {
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
  /** Only profiles carry one; household records without an account don't. */
  suffix?: string | null;
}

const UNNAMED = "(unnamed)";

function joinName(first: string, p: NameParts): string {
  const name = [first, p.last_name?.trim() || ""].filter(Boolean).join(" ");
  if (!name) return UNNAMED;
  const suffix = p.suffix?.trim();
  return suffix ? `${name} ${suffix}` : name;
}

/**
 * Display name for a member. Uses preferred_name instead of first_name if
 * set (e.g. "Danny" for "Daniel"), then last_name and the suffix. Falls back
 * to "(unnamed)" if there is no first or last name.
 */
export function displayName(p: NameParts | null | undefined): string {
  if (!p) return UNNAMED;
  return joinName(p.preferred_name?.trim() || p.first_name?.trim() || "", p);
}

/** Whether displayName() has a name to show rather than its fallback. */
export function hasName(p: NameParts | null | undefined): boolean {
  return displayName(p) !== UNNAMED;
}

/**
 * Formal display name — always uses first_name (ignores preferred_name).
 * Use for admin views or formal contexts.
 */
export function formalName(p: NameParts | null | undefined): string {
  if (!p) return UNNAMED;
  return joinName(p.first_name?.trim() || "", p);
}

/**
 * The display name with the person's title in front ("Dr. Ana Rivera"). Only
 * the profile page and a group's Leadership list show a title; lists never do.
 */
export function titledName(
  p: (NameParts & { title?: string | null }) | null | undefined,
): string {
  const name = displayName(p);
  const title = p?.title?.trim();
  return title && name !== UNNAMED ? `${title} ${name}` : name;
}

/**
 * Two-letter initials for avatar fallbacks.
 */
export function initials(p: NameParts | null | undefined): string {
  if (!p) return "??";
  const first = (p.preferred_name?.trim() || p.first_name?.trim() || "?").charAt(0);
  const last = (p.last_name?.trim() || "").charAt(0);
  return (first + last).toUpperCase() || "??";
}
