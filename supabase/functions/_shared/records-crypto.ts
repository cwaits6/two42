// A church's key to its records is stored only as AES-256-GCM ciphertext,
// sealed with a key derived per church and provider from RECORDS_KEY_SECRET.
// The database never sees the key in the clear, so a leaked row or backup does
// not open the church's records.
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export const RECORDS_SECRET_ENV = "RECORDS_KEY_SECRET";

export class RecordsCryptoError extends Error {}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = "k1";

/** Strict base64 of exactly 32 bytes, or null. */
export function parseRecordsSecret(value: string | undefined): Buffer | null {
  const text = value?.trim();
  if (!text) return null;
  const bytes = Buffer.from(text, "base64");
  if (bytes.length !== KEY_BYTES || bytes.toString("base64") !== text) return null;
  return bytes;
}

function keyId(master: Buffer): string {
  return createHash("sha256").update("two42 records key id\0").update(master).digest("hex").slice(0, 8);
}

function orgKey(master: Buffer, orgId: string, provider: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `two42/records-key/v1/${provider}/${orgId}`, KEY_BYTES));
}

// Binding the church and provider means a sealed key copied onto another church's row fails to open.
const aad = (orgId: string, provider: string) => Buffer.from(`records-key:${provider}:${orgId}`);

export function sealKey(master: Buffer, orgId: string, provider: string, key: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", orgKey(master, orgId, provider), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(orgId, provider));
  const sealed = Buffer.concat([cipher.update(key, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [ENVELOPE_VERSION, keyId(master), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/** Throws RecordsCryptoError for another secret, a damaged envelope, or one sealed for another church or provider. */
export function openKey(master: Buffer, orgId: string, provider: string, envelope: string): string {
  const [version, kid, ivText, sealedText, ...rest] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !sealedText || rest.length > 0) {
    throw new RecordsCryptoError("not a records key envelope");
  }
  if (kid !== keyId(master)) throw new RecordsCryptoError("records key was sealed with a secret that is not configured");
  const iv = Buffer.from(ivText, "base64url");
  const sealed = Buffer.from(sealedText, "base64url");
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) throw new RecordsCryptoError("not a records key envelope");
  try {
    const decipher = createDecipheriv("aes-256-gcm", orgKey(master, orgId, provider), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(orgId, provider));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new RecordsCryptoError("records key failed to open");
  }
}
