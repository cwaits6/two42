/**
 * Every page under app/, as its route pattern. An address that matches none
 * of these sends nothing, so a page missing here is unmeasured, never leaked.
 */
export const PAGE_PATTERNS: readonly string[] = [
  "/",
  "/admin",
  "/admin/families",
  "/admin/groups",
  "/admin/groups/[id]",
  "/admin/invite",
  "/admin/members",
  "/admin/members/[id]",
  "/admin/members/invite",
  "/admin/requests",
  "/admin/settings",
  "/admin/settings/email",
  "/admin/usage",
  "/calendar",
  "/dashboard",
  "/directory",
  "/directory/anniversaries",
  "/directory/birthdays",
  "/directory/families",
  "/directory/groups",
  "/find-a-group",
  "/forgot-password",
  "/g/[groupId]/about",
  "/g/[groupId]/about/edit",
  "/g/[groupId]/announcements",
  "/g/[groupId]/announcements/[id]/edit",
  "/g/[groupId]/announcements/new",
  "/g/[groupId]/calendar",
  "/g/[groupId]/calendar/[id]",
  "/g/[groupId]/calendar/[id]/edit",
  "/g/[groupId]/calendar/new",
  "/g/[groupId]/dashboard",
  "/g/[groupId]/directory",
  "/g/[groupId]/directory/anniversaries",
  "/g/[groupId]/directory/birthdays",
  "/g/[groupId]/directory/families",
  "/g/[groupId]/directory/groups",
  "/g/[groupId]/give",
  "/g/[groupId]/give/[fundId]/edit",
  "/g/[groupId]/give/new",
  "/g/[groupId]/lectures",
  "/g/[groupId]/lectures/[id]",
  "/g/[groupId]/lectures/[id]/edit",
  "/g/[groupId]/lectures/new",
  "/g/[groupId]/lectures/series",
  "/g/[groupId]/lectures/series/[id]",
  "/g/[groupId]/lectures/series/[id]/edit",
  "/g/[groupId]/lectures/series/new",
  "/g/[groupId]/prayer",
  "/g/[groupId]/serving",
  "/g/[groupId]/serving/[teamId]",
  "/g/[groupId]/settings",
  "/g/[groupId]/settings/details",
  "/g/[groupId]/settings/invites",
  "/g/[groupId]/settings/labels",
  "/g/[groupId]/settings/privacy",
  "/g/[groupId]/settings/requests",
  "/g/[groupId]/settings/serving",
  "/g/[groupId]/settings/teams",
  "/household",
  "/join/[token]",
  "/join/family/[token]",
  "/login",
  "/platform",
  "/platform/organizations",
  "/platform/organizations/[id]",
  "/platform/usage",
  "/privacy",
  "/profile",
  "/profile/setup",
  "/serving/go",
  "/settings",
  "/setup-account",
  "/terms",
  "/update-password",
];

const isDynamic = (segment: string) => segment.startsWith("[");

const segmentsOf = (path: string) => (path === "/" ? [] : path.slice(1).split("/"));

const COMPILED = PAGE_PATTERNS.map((pattern) => ({ pattern, segments: segmentsOf(pattern) }));

/** The route pattern of a pathname, or null when no page matches it. */
export function pagePattern(pathname: string): string | null {
  if (!pathname.startsWith("/")) return null;
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const parts = segmentsOf(trimmed);

  let best: (typeof COMPILED)[number] | null = null;
  for (const candidate of COMPILED) {
    const { segments } = candidate;
    if (segments.length !== parts.length) continue;
    if (!segments.every((s, i) => isDynamic(s) || s === parts[i])) continue;
    if (!best || staticComesFirst(segments, best.segments)) best = candidate;
  }
  return best?.pattern ?? null;
}

function staticComesFirst(a: string[], b: string[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (isDynamic(a[i]) !== isDynamic(b[i])) return !isDynamic(a[i]);
  }
  return false;
}

/** An address reduced to its origin and route pattern: no query, no hash, no real path. */
export function patternUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // The measurement script hands back the pattern it was given as the path, percent-encoded.
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const pattern = pagePattern(pathname);
  return pattern ? parsed.origin + pattern : null;
}

/** A measurement event with its address reduced to the pattern, or null to send nothing. */
export function patternOnly<E extends { url: string }>(event: E): E | null {
  const url = patternUrl(event.url);
  return url ? { ...event, url } : null;
}
