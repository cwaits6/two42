// Pure group-context helpers shared by the server resolver, the middleware,
// and the client frame. No React, no next/* imports, so every rule here is
// testable without I/O.

export type GroupRole = "leader" | "member";

export type ActiveGroup = {
  id: string;
  name: string;
  color: string;
  role: GroupRole;
};

export const GROUP_COOKIE = "two42-group";
export const GROUP_PREFIX = "/g";

// Every group is Clay until one calendar per group exists; the group's
// calendar color takes over then. Named in text beside the color everywhere.
export const GROUP_DEFAULT_COLOR = "#B85C38";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The server precedence: URL beats cookie beats first membership. The
 * memberships list is the authority — a URL id outside it yields null (the
 * caller 404s), and a cookie id outside it is ignored.
 */
export function resolveActiveGroup(input: {
  urlGroupId?: string | null;
  cookieGroupId?: string | null;
  memberships: ActiveGroup[];
}): ActiveGroup | null {
  const { urlGroupId, cookieGroupId, memberships } = input;
  if (urlGroupId) {
    return memberships.find((g) => g.id === urlGroupId) ?? null;
  }
  if (cookieGroupId) {
    const fromCookie = memberships.find((g) => g.id === cookieGroupId);
    if (fromCookie) return fromCookie;
  }
  return memberships[0] ?? null;
}

const GROUP_PATH = /^\/g\/([^/]+)(?:\/(.*))?$/;

/** "/g/<uuid>" or "/g/<uuid>/…" → the uuid; anything else → null. */
export function groupIdFromPath(pathname: string): string | null {
  const match = GROUP_PATH.exec(pathname);
  if (!match || !isUuid(match[1])) return null;
  return match[1];
}

export function groupPath(groupId: string, path: string): string {
  const rest = path.startsWith("/") ? path : `/${path}`;
  return `${GROUP_PREFIX}/${groupId}${rest}`;
}

// Sub-paths that survive a switch because the same page exists in every
// group; every other section truncates to its root so an entity id from
// group A never lands on group B.
const KEPT_SUBPATHS: Record<string, ReadonlySet<string>> = {
  directory: new Set(["families", "groups", "birthdays", "anniversaries"]),
  give: new Set(["new"]),
};

/** The switcher's target: the same page in another group. */
export function swapGroupInPath(pathname: string, target: ActiveGroup): string {
  const match = GROUP_PATH.exec(pathname);
  if (!match || !isUuid(match[1])) return groupPath(target.id, "/dashboard");

  const [section = "", sub] = (match[2] ?? "").split("/");
  if (section === "") return groupPath(target.id, "/dashboard");
  if (section === "settings" && target.role !== "leader") {
    return groupPath(target.id, "/dashboard");
  }
  const kept = sub && KEPT_SUBPATHS[section]?.has(sub) ? `/${sub}` : "";
  return groupPath(target.id, `/${section}${kept}`);
}

/** Unprefixed sections that now live under /g/ (or, for /events, at /calendar). */
export const LEGACY_GROUP_PREFIXES = [
  "/events",
  "/announcements",
  "/lectures",
  "/about",
  "/serving",
  "/prayer",
  "/give",
] as const;

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** True for a legacy section path. /serving/go is the emailed token landing and is excluded. */
export function isLegacyGroupPath(pathname: string): boolean {
  if (underPrefix(pathname, "/serving/go")) return false;
  return LEGACY_GROUP_PREFIXES.some((p) => underPrefix(pathname, p));
}

export type LegacyRedirect =
  | { needsGroup: false; path: string }
  | { needsGroup: true; pathFor: (groupId: string) => string };

/**
 * Where a legacy path goes. Bare /events is the org-level calendar and
 * needs no group; everything else is the same path under the active group.
 */
export function legacyRedirectTarget(pathname: string): LegacyRedirect | null {
  if (!isLegacyGroupPath(pathname)) return null;
  if (pathname === "/events") return { needsGroup: false, path: "/calendar" };
  const rest = pathname.startsWith("/events/")
    ? `/calendar${pathname.slice("/events".length)}`
    : pathname;
  return { needsGroup: true, pathFor: (groupId) => groupPath(groupId, rest) };
}

/** First letters of the first two words, upper-cased, for the collapsed rail. */
export function groupInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}
