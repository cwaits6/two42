// A church's Rock REST key is stored only as AES-256-GCM ciphertext, sealed
// with a key derived per church from ROCK_KEY_SECRET. The database never sees
// the key in the clear, so a leaked row or backup does not open the church's Rock.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export const ROCK_SECRET_ENV = "ROCK_KEY_SECRET";

export class RockCryptoError extends Error {}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = "r1";

/** Strict base64 of exactly 32 bytes, or null. */
export function parseRockSecret(value: string | undefined): Buffer | null {
  const text = value?.trim();
  if (!text) return null;
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== KEY_BYTES || bytes.toString("base64") !== text) return null;
  return bytes;
}

/** The secret from the server environment, or null when it is missing or malformed. */
export function loadRockSecret(): Buffer | null {
  return parseRockSecret(process.env[ROCK_SECRET_ENV]);
}

function keyId(master: Buffer): string {
  return createHash("sha256").update("two42 rock key id\0").update(master).digest("hex").slice(0, 8);
}

function orgKey(master: Buffer, orgId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `two42/rock-rest-key/v1/${orgId}`, KEY_BYTES));
}

// Binding the church means a sealed key copied onto another church's row fails to open.
const aad = (orgId: string) => Buffer.from(`rock-rest-key:${orgId}`);

export function sealRestKey(master: Buffer, orgId: string, restKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", orgKey(master, orgId), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(orgId));
  const sealed = Buffer.concat([cipher.update(restKey, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [ENVELOPE_VERSION, keyId(master), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/** Throws RockCryptoError for another secret, a damaged envelope, or one sealed for another church. */
export function openRestKey(master: Buffer, orgId: string, envelope: string): string {
  const [version, kid, ivText, sealedText, ...rest] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !sealedText || rest.length > 0) {
    throw new RockCryptoError("not a Rock key envelope");
  }
  if (kid !== keyId(master)) throw new RockCryptoError("Rock key was sealed with a secret that is not configured");
  const iv = Buffer.from(ivText, "base64url");
  const sealed = Buffer.from(sealedText, "base64url");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) throw new RockCryptoError("not a Rock key envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", orgKey(master, orgId), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(orgId));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new RockCryptoError("Rock key failed to open");
  }
}
