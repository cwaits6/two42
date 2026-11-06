/**
 * Name display helpers. The canonical name on a profile is first + last —
 * there is no stored `full_name` column. Any display of a member's name
 * should go through these helpers so formatting stays consistent.
 */

export interface NameParts {
  first_name: string | null;
  last_name: string | null;
  preferred_name?: string | null;
}

const UNNAMED = "(unnamed)";

/**
 * Display name for a member. Uses preferred_name instead of first_name if
 * set (e.g. "Danny" for "Daniel"), then appends last_name. Falls back to
 * "(unnamed)" if nothing is set.
 */
export function displayName(p: NameParts | null | undefined): string {
  if (!p) return UNNAMED;
  const first = p.preferred_name?.trim() || p.first_name?.trim() || "";
  const last = p.last_name?.trim() || "";
  const name = [first, last].filter(Boolean).join(" ");
  return name || UNNAMED;
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
  if (!p) return "(unnamed)";
  const first = p.first_name?.trim() || "";
  const last = p.last_name?.trim() || "";
  const name = [first, last].filter(Boolean).join(" ");
  return name || "(unnamed)";
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
