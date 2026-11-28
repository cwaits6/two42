import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECORDS_CRYPTO_VECTOR as V } from "@/supabase/functions/_shared/records-crypto-vector";
import {
  openKey,
  parseRecordsSecret,
  parseRecordsSecrets,
  RecordsCryptoError,
  recordsKeyId,
  type RecordsSecrets,
  sealKey,
} from "./crypto";

const secret = randomBytes(32);
const only = (current: Buffer): RecordsSecrets => ({ current, previous: null });
const secrets = only(secret);

describe("church records key sealing", () => {
  it("opens what it sealed, and the envelope doesn't contain the key", () => {
    const envelope = sealKey(secrets, "org-a", "rock", "AbCdEf123456GhIjKl789012");
    expect(envelope).not.toContain("AbCdEf123456");
    expect(openKey(secrets, "org-a", "rock", envelope)).toBe("AbCdEf123456GhIjKl789012");
  });

  it("won't open a key sealed for another church", () => {
    const envelope = sealKey(secrets, "org-a", "rock", "key-for-a-only");
    expect(() => openKey(secrets, "org-b", "rock", envelope)).toThrow(RecordsCryptoError);
  });

  it("won't open a key sealed for another provider", () => {
    const envelope = sealKey(secrets, "org-a", "rock", "key-for-rock-only");
    expect(() => openKey(secrets, "org-a", "other", envelope)).toThrow(RecordsCryptoError);
  });

  it("won't open with another secret", () => {
    const envelope = sealKey(secrets, "org-a", "rock", "key-for-a-only");
    expect(() => openKey(only(randomBytes(32)), "org-a", "rock", envelope)).toThrow(RecordsCryptoError);
  });

  it("refuses a damaged envelope", () => {
    const [v, kid, iv, sealed] = sealKey(secrets, "org-a", "rock", "key-for-a-only").split(".");
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => openKey(secrets, "org-a", "rock", [v, kid, iv, flipped].join("."))).toThrow(RecordsCryptoError);
    expect(() => openKey(secrets, "org-a", "rock", "plain text")).toThrow(RecordsCryptoError);
  });

  it("accepts only strict base64 of 32 bytes as the secret", () => {
    expect(parseRecordsSecret(secret.toString("base64"))).toEqual(secret);
    expect(parseRecordsSecret(undefined)).toBeNull();
    expect(parseRecordsSecret("short")).toBeNull();
    expect(parseRecordsSecret(randomBytes(16).toString("base64"))).toBeNull();
  });
});

describe("rotating the records secret", () => {
  const old = randomBytes(32);
  const rotating: RecordsSecrets = { current: secret, previous: old };

  it("opens a key sealed under the previous secret while both are set", () => {
    const envelope = sealKey(only(old), "org-a", "rock", "sealed-before-rotation");
    expect(openKey(rotating, "org-a", "rock", envelope)).toBe("sealed-before-rotation");
  });

  it("seals under the current secret, so the key opens once the previous one is gone", () => {
    const envelope = sealKey(rotating, "org-a", "rock", "sealed-during-rotation");
    expect(envelope.split(".")[1]).toBe(recordsKeyId(secret));
    expect(openKey(only(secret), "org-a", "rock", envelope)).toBe("sealed-during-rotation");
  });

  it("won't open a key sealed under neither secret", () => {
    const envelope = sealKey(only(randomBytes(32)), "org-a", "rock", "someone-elses");
    expect(() => openKey(rotating, "org-a", "rock", envelope)).toThrow(RecordsCryptoError);
  });

  it("opens a key sealed before rotation existed, under the current secret and as the previous one", () => {
    const shipped = parseRecordsSecret(V.secret)!;
    expect(openKey(only(shipped), V.orgId, V.provider, V.envelope)).toBe(V.key);
    expect(openKey({ current: secret, previous: shipped }, V.orgId, V.provider, V.envelope)).toBe(V.key);
  });

  it("refuses an envelope that names no secret rather than guessing one", () => {
    const [v, , iv, sealed] = sealKey(secrets, "org-a", "rock", "no-id").split(".");
    expect(() => openKey(rotating, "org-a", "rock", [v, iv, sealed].join("."))).toThrow(RecordsCryptoError);
  });
});

describe("reading the records secrets", () => {
  const good = secret.toString("base64");
  const oldText = randomBytes(32).toString("base64");
  const env = (values: Record<string, string>) => (name: string) => values[name];

  it("is fine without a previous secret", () => {
    expect(parseRecordsSecrets(env({ RECORDS_KEY_SECRET: good }))).toEqual({
      secrets: { current: secret, previous: null },
      malformed: null,
    });
    expect(parseRecordsSecrets(env({ RECORDS_KEY_SECRET: good, RECORDS_KEY_SECRET_PREVIOUS: "  " })).secrets?.previous).toBeNull();
  });

  it("reads both during a rotation", () => {
    const { secrets: both } = parseRecordsSecrets(env({ RECORDS_KEY_SECRET: good, RECORDS_KEY_SECRET_PREVIOUS: oldText }));
    expect(both?.previous?.toString("base64")).toBe(oldText);
  });

  it("turns off on a malformed previous secret, naming it", () => {
    expect(parseRecordsSecrets(env({ RECORDS_KEY_SECRET: good, RECORDS_KEY_SECRET_PREVIOUS: "not-a-key" }))).toEqual({
      secrets: null,
      malformed: "RECORDS_KEY_SECRET_PREVIOUS",
    });
  });

  it("turns off on a malformed current secret, naming it", () => {
    expect(parseRecordsSecrets(env({ RECORDS_KEY_SECRET: "not-a-key", RECORDS_KEY_SECRET_PREVIOUS: oldText }))).toEqual({
      secrets: null,
      malformed: "RECORDS_KEY_SECRET",
    });
  });

  it("is off without a current secret, and nothing is malformed", () => {
    expect(parseRecordsSecrets(env({ RECORDS_KEY_SECRET_PREVIOUS: oldText }))).toEqual({ secrets: null, malformed: null });
  });
});

describe("loading the records secrets in the app", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.doUnmock("@/lib/log");
    vi.resetModules();
  });

  it("logs a malformed previous secret once, with a fixed message and never its value", async () => {
    const logError = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/log", () => ({ logError }));
    process.env.RECORDS_KEY_SECRET = secret.toString("base64");
    process.env.RECORDS_KEY_SECRET_PREVIOUS = "leaky-not-a-key";
    const { loadRecordsSecret } = await import("./crypto");

    expect(loadRecordsSecret()).toBeNull();
    expect(loadRecordsSecret()).toBeNull();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("Church records are off: RECORDS_KEY_SECRET_PREVIOUS is not a valid key");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("leaky");
  });

  it("logs a malformed current secret with its own fixed message", async () => {
    const logError = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/log", () => ({ logError }));
    process.env.RECORDS_KEY_SECRET = "leaky-not-a-key";
    const { loadRecordsSecret } = await import("./crypto");

    expect(loadRecordsSecret()).toBeNull();
    expect(logError).toHaveBeenCalledWith("Church records are off: RECORDS_KEY_SECRET is not a valid key");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("leaky");
  });

  it("logs nothing when the previous secret is missing", async () => {
    const logError = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/log", () => ({ logError }));
    process.env.RECORDS_KEY_SECRET = secret.toString("base64");
    delete process.env.RECORDS_KEY_SECRET_PREVIOUS;
    const { loadRecordsSecret } = await import("./crypto");

    expect(loadRecordsSecret()).toEqual({ current: secret, previous: null });
    expect(logError).not.toHaveBeenCalled();
  });
});
