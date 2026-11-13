// The prayer request routes' wire contract, shared by the routes and the board.
// Text is sealed, so the table can no longer check its length; this is the
// one place the limit lives.

export const REQUEST_TEXT_MAX = 2000;

export interface NewPrayerRequest {
  body: string;
  is_anonymous: boolean;
}

export interface PostedPrayerRequest {
  id: string;
  created_at: string;
}

export type PrayerRequestEdit = Partial<NewPrayerRequest & { is_answered: boolean }>;

export interface PrayerRequestSaved {
  ok: true;
}

/** 1 to REQUEST_TEXT_MAX characters, counted as the person sees them. */
export function requestText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const length = [...value].length;
  return length >= 1 && length <= REQUEST_TEXT_MAX ? value : null;
}
