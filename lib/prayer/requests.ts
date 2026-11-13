// The prayer request routes' wire contract, shared by the routes and the board.
// The table holds only sealed text and cannot check its length, so the limit
// lives here.

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

type JsonObject = Record<string, unknown>;
const optionalBoolean = (value: unknown): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

/** The POST body, or null when it is not a valid new request. */
export function parseNewRequest(input: JsonObject | null): NewPrayerRequest | null {
  const body = requestText(input?.body);
  if (!input || body === null || typeof input.is_anonymous !== "boolean") return null;
  return { body, is_anonymous: input.is_anonymous };
}

/** The PATCH body, or null when it is invalid or changes nothing. */
export function parseRequestEdit(input: JsonObject | null): PrayerRequestEdit | null {
  if (!input) return null;
  const { is_answered, is_anonymous } = input;
  const body = input.body === undefined ? undefined : requestText(input.body);
  if (body === null || !optionalBoolean(is_answered) || !optionalBoolean(is_anonymous)) return null;
  if (body === undefined && is_answered === undefined && is_anonymous === undefined) return null;
  return { body, is_answered, is_anonymous };
}
