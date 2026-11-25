import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openKey, parseRecordsSecret, RecordsCryptoError, sealKey } from "./crypto";

const secret = randomBytes(32);

describe("church records key sealing", () => {
  it("opens what it sealed, and the envelope doesn't contain the key", () => {
    const envelope = sealKey(secret, "org-a", "rock", "AbCdEf123456GhIjKl789012");
    expect(envelope).not.toContain("AbCdEf123456");
    expect(openKey(secret, "org-a", "rock", envelope)).toBe("AbCdEf123456GhIjKl789012");
  });

  it("won't open a key sealed for another church", () => {
    const envelope = sealKey(secret, "org-a", "rock", "key-for-a-only");
    expect(() => openKey(secret, "org-b", "rock", envelope)).toThrow(RecordsCryptoError);
  });

  it("won't open a key sealed for another provider", () => {
    const envelope = sealKey(secret, "org-a", "rock", "key-for-rock-only");
    expect(() => openKey(secret, "org-a", "other", envelope)).toThrow(RecordsCryptoError);
  });

  it("won't open with another secret", () => {
    const envelope = sealKey(secret, "org-a", "rock", "key-for-a-only");
    expect(() => openKey(randomBytes(32), "org-a", "rock", envelope)).toThrow(RecordsCryptoError);
  });

  it("refuses a damaged envelope", () => {
    const [v, kid, iv, sealed] = sealKey(secret, "org-a", "rock", "key-for-a-only").split(".");
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => openKey(secret, "org-a", "rock", [v, kid, iv, flipped].join("."))).toThrow(RecordsCryptoError);
    expect(() => openKey(secret, "org-a", "rock", "plain text")).toThrow(RecordsCryptoError);
  });

  it("accepts only strict base64 of 32 bytes as the secret", () => {
    expect(parseRecordsSecret(secret.toString("base64"))).toEqual(secret);
    expect(parseRecordsSecret(undefined)).toBeNull();
    expect(parseRecordsSecret("short")).toBeNull();
    expect(parseRecordsSecret(randomBytes(16).toString("base64"))).toBeNull();
  });
});
