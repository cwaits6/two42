// The prayer comment routes' wire contract, shared by the routes, the page and
// the board. The table holds only sealed text and cannot check its length, so
// the limit lives here.

export const COMMENT_TEXT_MAX = 500;

export interface NewPrayerComment {
  body: string;
  /** Readable only by the writer and the person who posted the request. */
  only_asker: boolean;
  /** Stores no writer id, so the comment shows no name to anyone. */
  hide_name: boolean;
}

export interface PostedPrayerComment {
  id: string;
  created_at: string;
}

/** A comment as the board renders it; a hidden-name comment carries no name. */
export interface PrayerCommentView {
  id: string;
  request_id: string;
  body: string;
  only_asker: boolean;
  hide_name: boolean;
  created_at: string;
  mine: boolean;
  can_delete: boolean;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

/** 1 to COMMENT_TEXT_MAX characters after trimming, counted as the person sees them. */
export function commentText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = [...text].length;
  return length >= 1 && length <= COMMENT_TEXT_MAX ? text : null;
}

/** The POST body, or null when it is not a valid new comment. */
export function parseNewComment(input: Record<string, unknown> | null): NewPrayerComment | null {
  const body = commentText(input?.body);
  if (!input || body === null || typeof input.only_asker !== "boolean" || typeof input.hide_name !== "boolean") {
    return null;
  }
  return { body, only_asker: input.only_asker, hide_name: input.hide_name };
}
