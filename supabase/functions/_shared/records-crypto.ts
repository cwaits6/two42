// A church's key to its records is stored only as AES-256-GCM ciphertext,
// sealed with a key derived per church and provider from RECORDS_KEY_SECRET.
// The database never sees the key in the clear, so a leaked row or backup does
// not open the church's records. RECORDS_KEY_SECRET_PREVIOUS is read only to
// open keys still sealed with the old secret while it is being rotated.
//
// scripts/reseal-records-keys.mjs imports this file under Node's type
// stripping, so it imports only node: modules and uses only erasable TypeScript.
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export const RECORDS_SECRET_ENV = "RECORDS_KEY_SECRET";
export const RECORDS_SECRET_PREVIOUS_ENV = "RECORDS_KEY_SECRET_PREVIOUS";

export interface RecordsSecrets {
  current: Buffer;
  /** Set only while the secret is being rotated, so keys still sealed under it open. */
  previous: Buffer | null;
}

export type RecordsSecretEnv = typeof RECORDS_SECRET_ENV | typeof RECORDS_SECRET_PREVIOUS_ENV;

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

/**
 * Null secrets when the current secret is unset, or when either is set but not
 * a key; `malformed` names the variable at fault. A malformed previous secret
 * turns everything off rather than surfacing later as keys that fail to open.
 */
export function parseRecordsSecrets(get: (name: string) => string | undefined): {
  secrets: RecordsSecrets | null;
  malformed: RecordsSecretEnv | null;
} {
  const currentText = get(RECORDS_SECRET_ENV);
  if (!currentText?.trim()) return { secrets: null, malformed: null };
  const current = parseRecordsSecret(currentText);
  if (!current) return { secrets: null, malformed: RECORDS_SECRET_ENV };
  const previousText = get(RECORDS_SECRET_PREVIOUS_ENV);
  if (!previousText?.trim()) return { secrets: { current, previous: null }, malformed: null };
  const previous = parseRecordsSecret(previousText);
  if (!previous) return { secrets: null, malformed: RECORDS_SECRET_PREVIOUS_ENV };
  return { secrets: { current, previous }, malformed: null };
}

/** Names a secret without revealing it, so an envelope says which secret sealed it. */
export function recordsKeyId(secret: Buffer): string {
  return createHash("sha256").update("two42 records key id\0").update(secret).digest("hex").slice(0, 8);
}

function secretFor(secrets: RecordsSecrets, kid: string): Buffer | null {
  if (recordsKeyId(secrets.current) === kid) return secrets.current;
  if (secrets.previous && recordsKeyId(secrets.previous) === kid) return secrets.previous;
  return null;
}

/** Whether the envelope names the current secret. */
export function sealedWithCurrentSecret(secrets: RecordsSecrets, envelope: string): boolean {
  return envelope.split(".")[1] === recordsKeyId(secrets.current);
}

/**
 * The write key's sealing label: one of its own, so a write key copied into
 * the read key's column, or the reverse, fails to open.
 */
export function intakeKeyLabel(providerId: string): string {
  return `${providerId}-intake`;
}

function orgKey(master: Buffer, orgId: string, provider: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `two42/records-key/v1/${provider}/${orgId}`, KEY_BYTES));
}

// Binding the church and provider means a sealed key copied onto another church's row fails to open.
const aad = (orgId: string, provider: string) => Buffer.from(`records-key:${provider}:${orgId}`);

export function sealKey(secrets: RecordsSecrets, orgId: string, provider: string, key: string): string {
  const master = secrets.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", orgKey(master, orgId, provider), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(orgId, provider));
  const sealed = Buffer.concat([cipher.update(key, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [ENVELOPE_VERSION, recordsKeyId(master), iv.toString("base64url"), sealed.toString("base64url")].join(".");
}

/**
 * Opens with the secret the envelope names. Throws RecordsCryptoError for a
 * secret that is not configured, a damaged envelope, or one sealed for another
 * church or provider.
 */
export function openKey(secrets: RecordsSecrets, orgId: string, provider: string, envelope: string): string {
  const [version, kid, ivText, sealedText, ...rest] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !sealedText || rest.length > 0) {
    throw new RecordsCryptoError("not a records key envelope");
  }
  const master = secretFor(secrets, kid);
  if (!master) throw new RecordsCryptoError("records key was sealed with a secret that is not configured");
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
