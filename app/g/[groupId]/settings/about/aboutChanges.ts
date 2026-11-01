import { isUuid } from "@/lib/groups/active";
import { validateGroupColor } from "@/lib/groups/settings";

export type LeaderEntry = { profile_id: string; title: string; bio: string };

/** A field left out stays as saved; a blank one is cleared. */
export type LeaderEdit = { profile_id: string; title?: string; bio?: string };

/**
 * Only what this leader changed, so a Save never undoes another leader's edit
 * or removal. `added` and `edited` stay apart so that editing an entry someone
 * else removed cannot bring it back. `order` is the whole page order, present
 * only when this leader changed it, and is required once anyone is added.
 */
export type LeaderChanges = {
  added: LeaderEntry[];
  edited: LeaderEdit[];
  removed: string[];
  order?: string[];
};

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
  leaders?: LeaderChanges;
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

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function leaderChanges(saved: LeaderEntry[], draft: LeaderEntry[]): LeaderChanges {
  const before = new Map(saved.map((l) => [l.profile_id, l]));
  const draftIds = draft.map((l) => l.profile_id);
  const kept = new Set(draftIds);
  const keptIds = saved.map((l) => l.profile_id).filter((id) => kept.has(id));
  const changes: LeaderChanges = {
    added: draft.filter((l) => !before.has(l.profile_id)),
    edited: draft.flatMap((l) => {
      const was = before.get(l.profile_id);
      if (!was || (was.title === l.title && was.bio === l.bio)) return [];
      return [
        {
          profile_id: l.profile_id,
          ...(was.title !== l.title && { title: l.title }),
          ...(was.bio !== l.bio && { bio: l.bio }),
        },
      ];
    }),
    removed: saved.map((l) => l.profile_id).filter((id) => !kept.has(id)),
  };
  if (!sameIds(keptIds, draftIds)) changes.order = draftIds;
  return changes;
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
    changes.leaders = leaderChanges(saved.leaders, draft.leaders);
  }
  return changes;
}

export function hasChanges(changes: AboutChanges): boolean {
  return Object.keys(changes).length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEdits(raw: unknown): LeaderEdit[] | null {
  if (!Array.isArray(raw)) return null;
  const edits: LeaderEdit[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { profile_id, title, bio } = entry;
    if (typeof profile_id !== "string" || !isUuid(profile_id)) return null;
    if (title !== undefined && typeof title !== "string") return null;
    if (bio !== undefined && typeof bio !== "string") return null;
    edits.push({
      profile_id,
      ...(title !== undefined && { title: title.trim() }),
      ...(bio !== undefined && { bio: bio.trim() }),
    });
  }
  return edits;
}

function isEntry(edit: LeaderEdit): edit is LeaderEntry {
  return edit.title !== undefined && edit.bio !== undefined;
}

function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.every((id) => typeof id === "string" && isUuid(id)) ? (raw as string[]) : null;
}

function parseLeaders(raw: unknown): LeaderChanges | null {
  if (!isRecord(raw)) return null;
  const added = parseEdits(raw.added);
  const edited = parseEdits(raw.edited);
  const removed = parseIds(raw.removed);
  if (!added?.every(isEntry) || !edited || !removed) return null;

  const named = [...added.map((l) => l.profile_id), ...edited.map((l) => l.profile_id), ...removed];
  if (new Set(named).size !== named.length) return null;

  const changes: LeaderChanges = { added, edited, removed };
  if (raw.order !== undefined) {
    const order = parseIds(raw.order);
    if (!order || new Set(order).size !== order.length) return null;
    if (removed.some((id) => order.includes(id))) return null;
    changes.order = order;
  }
  if (added.some((l) => !changes.order?.includes(l.profile_id))) return null;
  return changes;
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
