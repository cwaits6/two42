// Prayer request text is stored as AES-256-GCM ciphertext, and an anonymous
// request's author as an HMAC of (request id, author id). Both keys live in the
// server environment and each church gets its own keys derived from them.
//
// scripts/encrypt-prayer-requests.mjs imports this file under Node's type
// stripping, so its only runtime import is node:crypto, every other import is
// `import type`, and it uses only erasable TypeScript. Keep it that way.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { Tables } from "../supabase/database.types";

type RequestRow = Tables<"prayer_requests">;

export interface KeyRing {
  current: Buffer;
  /** Set only while a rotation is under way, so rows still under it stay readable. */
  previous: Buffer | null;
}

export interface PrayerKeys {
  body: KeyRing;
  author: KeyRing;
}

export const PRAYER_KEY_ENV = {
  body: "PRAYER_BODY_KEY",
  bodyPrevious: "PRAYER_BODY_KEY_PREVIOUS",
  author: "PRAYER_AUTHOR_KEY",
  authorPrevious: "PRAYER_AUTHOR_KEY_PREVIOUS",
} as const;

export class PrayerCryptoError extends Error {}

const KEY_BYTES = 32;

/** Strict base64 of exactly 32 bytes, or null. */
function decodeKey(value: string | undefined): Buffer | null {
  const text = value?.trim();
  if (!text) return null;
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== KEY_BYTES || bytes.toString("base64") !== text) return null;
  return bytes;
}

/**
 * Null unless both current keys are set and valid. A previous key that is set
 * but invalid is also null: a typo there would otherwise surface only as rows
 * that fail to open.
 */
export function parsePrayerKeys(env: Record<string, string | undefined>): PrayerKeys | null {
  const body = decodeKey(env[PRAYER_KEY_ENV.body]);
  const author = decodeKey(env[PRAYER_KEY_ENV.author]);
  if (!body || !author) return null;
  const optional = (name: string): Buffer | null | undefined => {
    if (!env[name]?.trim()) return null;
    return decodeKey(env[name]) ?? undefined;
  };
  const bodyPrevious = optional(PRAYER_KEY_ENV.bodyPrevious);
  const authorPrevious = optional(PRAYER_KEY_ENV.authorPrevious);
  if (bodyPrevious === undefined || authorPrevious === undefined) return null;
  return {
    body: { current: body, previous: bodyPrevious },
    author: { current: author, previous: authorPrevious },
  };
}

/** Names a master key without revealing it, so a row says which key wrote it. */
export function keyId(master: Buffer): string {
  return createHash("sha256").update("two42 prayer key id\0").update(master).digest("hex").slice(0, 8);
}

type Purpose = "prayer-body" | "prayer-author";
const derived = new Map<string, Buffer>();

function orgKey(master: Buffer, purpose: Purpose, orgId: string): Buffer {
  const cacheKey = `${purpose}:${orgId}:${master.toString("base64")}`;
  let key = derived.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `two42/${purpose}/v1/${orgId}`, KEY_BYTES));
    derived.set(cacheKey, key);
  }
  return key;
}

function keyFor(ring: KeyRing, kid: string): Buffer | null {
  if (keyId(ring.current) === kid) return ring.current;
  if (ring.previous && keyId(ring.previous) === kid) return ring.previous;
  return null;
}

// Binding the row's church and id means ciphertext copied onto another row fails to open.
const aad = (orgId: string, requestId: string) => Buffer.from(`${orgId}:${requestId}`);

const ENVELOPE_VERSION = "v1";
const HASH_VERSION = "h1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptBody(keys: PrayerKeys, orgId: string, requestId: string, text: string): string {
  const master = keys.body.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", orgKey(master, "prayer-body", orgId), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad(orgId, requestId));
  const sealed = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [ENVELOPE_VERSION, keyId(master), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/** Throws PrayerCryptoError for an unknown key, a damaged envelope, or one sealed for another row. */
export function decryptBody(keys: PrayerKeys, orgId: string, requestId: string, envelope: string): string {
  const [version, kid, ivText, sealedText, ...rest] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !sealedText || rest.length > 0) {
    throw new PrayerCryptoError("not a prayer text envelope");
  }
  const master = keyFor(keys.body, kid);
  if (!master) throw new PrayerCryptoError("prayer text was sealed with a key that is not configured");
  const iv = Buffer.from(ivText, "base64url");
  const sealed = Buffer.from(sealedText, "base64url");
  if (iv.length !== IV_BYTES || sealed.length < TAG_BYTES) throw new PrayerCryptoError("not a prayer text envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", orgKey(master, "prayer-body", orgId), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad(orgId, requestId));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new PrayerCryptoError("prayer text failed to open");
  }
}

/** Whether the envelope is sealed with the current body key. */
export function sealedWithCurrentKey(keys: PrayerKeys, envelope: string): boolean {
  return envelope.split(".")[1] === keyId(keys.body.current);
}

function hmac(master: Buffer, orgId: string, requestId: string, authorId: string): string {
  return createHmac("sha256", orgKey(master, "prayer-author", orgId)).update(`${requestId}:${authorId}`).digest("base64url");
}

/**
 * Keyed over the request id as well as the author, so no two requests share a
 * value. The key id is the same on every row in a church and links nothing.
 */
export function authorHash(keys: PrayerKeys, orgId: string, requestId: string, authorId: string): string {
  const master = keys.author.current;
  return [HASH_VERSION, keyId(master), hmac(master, orgId, requestId, authorId)].join(".");
}

/** False for a hash under a key that is not configured. */
export function isAuthor(
  keys: PrayerKeys,
  orgId: string,
  requestId: string,
  authorId: string,
  stored: string,
): boolean {
  const [version, kid, mac, ...rest] = stored.split(".");
  if (version !== HASH_VERSION || !mac || rest.length > 0) return false;
  const master = keyFor(keys.author, kid);
  if (!master) return false;
  const expected = Buffer.from(hmac(master, orgId, requestId, authorId));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashedWithCurrentKey(keys: PrayerKeys, stored: string): boolean {
  return stored.split(".")[1] === keyId(keys.author.current);
}

/**
 * A hash cannot be opened, so the only proof that the backfill holds the app's
 * author key is a hash the app wrote under it. The key id names the master
 * key, so such a hash in any church proves it for every church. The backfill
 * writes a hash itself only once one exists, which keeps the proof the app's.
 */
export function authorKeyProven(keys: PrayerKeys, rows: readonly Pick<StoredRow, "author_hash">[]): boolean {
  return rows.some((row) => row.author_hash !== null && hashedWithCurrentKey(keys, row.author_hash));
}

/** Whether a plan writes an author hash, which cannot be checked until the app recognises its author. */
export function writesAuthorHash(plan: RowPlan): boolean {
  return plan.action === "write" && plan.steps.some((step) => step === "hash" || step === "rehash");
}

/** Who wrote a request, in the one form the row stores. */
export type RequestAuthor = { anonymous: boolean; authorId: string } | { anonymous: true; authorHash: string };

export type StoredForm = Pick<RequestRow, "is_anonymous" | "author_id" | "author_hash"> & {
  body: RequestRow["body"] & null;
  body_ciphertext: NonNullable<RequestRow["body_ciphertext"]>;
};

/**
 * The columns a write sets. It always fills one text form and one author form
 * and clears the other, which the table's check constraints also require.
 */
export function storedForm(
  keys: PrayerKeys,
  row: { id: string; orgId: string; text: string; author: RequestAuthor },
): StoredForm {
  const { author } = row;
  return {
    body: null,
    body_ciphertext: encryptBody(keys, row.orgId, row.id, row.text),
    is_anonymous: author.anonymous,
    author_id: author.anonymous ? null : author.authorId,
    author_hash: !author.anonymous
      ? null
      : "authorHash" in author
        ? author.authorHash
        : authorHash(keys, row.orgId, row.id, author.authorId),
  };
}

/** A prayer_requests row as the backfill reads it. */
export type StoredRow = Pick<
  RequestRow,
  "id" | "org_id" | "body" | "body_ciphertext" | "is_anonymous" | "author_id" | "author_hash"
>;

export type RowPlan =
  | { action: "noop" }
  | {
      action: "write";
      steps: ("encrypt" | "reencrypt" | "hash" | "rehash")[];
      patch: Pick<StoredForm, "body" | "body_ciphertext" | "author_id" | "author_hash">;
      /** The text still needs resealing, but the stale author hash matched no one and is kept as it is. */
      unmatched: boolean;
    }
  /** An anonymous hash under a key that is not current, matching no one in the church; nothing else to do. */
  | { action: "unmatched" }
  /** Text that cannot be opened with the configured keys. */
  | { action: "error" };

/**
 * What the backfill does to one row. Rows already in the current form plan as
 * noop, so a rerun after a partial run picks up only what is left. `memberIds`
 * is needed only to move an anonymous hash off the previous author key.
 */
export function planRow(row: StoredRow, keys: PrayerKeys, memberIds: readonly string[] = []): RowPlan {
  const steps: ("encrypt" | "reencrypt" | "hash" | "rehash")[] = [];
  let text: string;
  if (row.body_ciphertext) {
    try {
      text = decryptBody(keys, row.org_id, row.id, row.body_ciphertext);
    } catch {
      return { action: "error" };
    }
    if (!sealedWithCurrentKey(keys, row.body_ciphertext)) steps.push("reencrypt");
  } else if (row.body !== null) {
    text = row.body;
    steps.push("encrypt");
  } else {
    return { action: "error" };
  }

  let author_id = row.author_id;
  let author_hash = row.author_hash;
  let unmatched = false;
  if (row.is_anonymous && row.author_id) {
    author_hash = authorHash(keys, row.org_id, row.id, row.author_id);
    author_id = null;
    steps.push("hash");
  } else if (row.is_anonymous && row.author_hash && !hashedWithCurrentKey(keys, row.author_hash)) {
    const stored = row.author_hash;
    const match = memberIds.find((id) => isAuthor(keys, row.org_id, row.id, id, stored));
    if (match) {
      author_hash = authorHash(keys, row.org_id, row.id, match);
      steps.push("rehash");
    } else {
      unmatched = true;
    }
  }

  if (steps.length === 0) return unmatched ? { action: "unmatched" } : { action: "noop" };
  const reseal = steps.includes("encrypt") || steps.includes("reencrypt");
  return {
    action: "write",
    steps,
    unmatched,
    patch: {
      body: null,
      body_ciphertext: reseal || !row.body_ciphertext ? encryptBody(keys, row.org_id, row.id, text) : row.body_ciphertext,
      author_id,
      author_hash,
    },
  };
}
