import { isUuid } from "@/lib/groups/active";
import { validateGroupColor } from "@/lib/groups/settings";

export type LeaderEntry = { profile_id: string; title: string; bio: string };

/**
 * What one Save writes. A section is present only when it changed, so a Save
 * never rewrites a section this leader did not touch. Applying the same
 * changes twice lands in the same state, so a retry after a partial failure
 * is safe.
 */
export type AboutChanges = {
  summary?: string;
  color?: string;
  videoCall?: { url: string; time: string };
  /** `list` is the page order. `removed` is named so a Save never drops an entry another leader just added. */
  leaders?: { list: LeaderEntry[]; removed: string[] };
};

export type AboutFields = {
  color: string;
  videoCallUrl: string;
  videoCallTime: string;
  leaders: LeaderEntry[];
};

/** The About page only links an https address, so nothing else may be saved. */
export function isHttpsOrEmpty(value: string): boolean {
  return value === "" || value.startsWith("https://");
}

export function colorError(color: string): string | undefined {
  return validateGroupColor(color).ok
    ? undefined
    : "Choose a darker or lighter color, so text on it stays easy to read.";
}

export function videoCallUrlError(url: string): string | undefined {
  return isHttpsOrEmpty(url.trim()) ? undefined : "Enter a link that starts with https://";
}

function sameLeaders(a: LeaderEntry[], b: LeaderEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, i) =>
        entry.profile_id === b[i].profile_id && entry.title === b[i].title && entry.bio === b[i].bio,
    )
  );
}

/** The sections that differ from what is saved. `summary` is passed only once the editor has been edited. */
export function aboutChanges(
  saved: AboutFields,
  draft: AboutFields,
  summary: string | null,
): AboutChanges {
  const changes: AboutChanges = {};
  if (summary !== null) changes.summary = summary;
  if (draft.color !== saved.color) changes.color = draft.color;
  const url = draft.videoCallUrl.trim();
  const time = draft.videoCallTime.trim();
  if (url !== saved.videoCallUrl || time !== saved.videoCallTime) {
    changes.videoCall = { url, time };
  }
  if (!sameLeaders(saved.leaders, draft.leaders)) {
    const kept = new Set(draft.leaders.map((l) => l.profile_id));
    changes.leaders = {
      list: draft.leaders,
      removed: saved.leaders.map((l) => l.profile_id).filter((id) => !kept.has(id)),
    };
  }
  return changes;
}

export function hasChanges(changes: AboutChanges): boolean {
  return Object.keys(changes).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLeaders(raw: unknown): AboutChanges["leaders"] | null {
  if (!isRecord(raw) || !Array.isArray(raw.list) || !Array.isArray(raw.removed)) return null;
  const list: LeaderEntry[] = [];
  for (const entry of raw.list) {
    if (!isRecord(entry)) return null;
    const { profile_id, title, bio } = entry;
    if (typeof profile_id !== "string" || !isUuid(profile_id)) return null;
    if (typeof title !== "string" || typeof bio !== "string") return null;
    list.push({ profile_id, title: title.trim(), bio: bio.trim() });
  }
  const removed: string[] = [];
  for (const id of raw.removed) {
    if (typeof id !== "string" || !isUuid(id)) return null;
    removed.push(id);
  }
  const listed = new Set(list.map((l) => l.profile_id));
  if (listed.size !== list.length || removed.some((id) => listed.has(id))) return null;
  return { list, removed };
}

/** The request body as changes, or null when any part of it is malformed: nothing is written then. */
export function parseAboutChanges(raw: unknown): AboutChanges | null {
  if (!isRecord(raw)) return null;
  const changes: AboutChanges = {};
  if (raw.summary !== undefined) {
    if (typeof raw.summary !== "string") return null;
    changes.summary = raw.summary;
  }
  if (raw.color !== undefined) {
    const check = validateGroupColor(raw.color);
    if (!check.ok) return null;
    changes.color = check.color;
  }
  if (raw.videoCall !== undefined) {
    if (!isRecord(raw.videoCall)) return null;
    const { url, time } = raw.videoCall;
    if (typeof url !== "string" || typeof time !== "string") return null;
    if (!isHttpsOrEmpty(url.trim())) return null;
    changes.videoCall = { url: url.trim(), time: time.trim() };
  }
  if (raw.leaders !== undefined) {
    const leaders = parseLeaders(raw.leaders);
    if (!leaders) return null;
    changes.leaders = leaders;
  }
  return changes;
}
