import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openRestKey, parseRockSecret, RockCryptoError, sealRestKey } from "./crypto";

const secret = randomBytes(32);

describe("Rock REST key sealing", () => {
  it("opens what it sealed, and the envelope doesn't contain the key", () => {
    const envelope = sealRestKey(secret, "org-a", "AbCdEf123456GhIjKl789012");
    expect(envelope).not.toContain("AbCdEf123456");
    expect(openRestKey(secret, "org-a", envelope)).toBe("AbCdEf123456GhIjKl789012");
  });

  it("won't open a key sealed for another church", () => {
    const envelope = sealRestKey(secret, "org-a", "key-for-a-only");
    expect(() => openRestKey(secret, "org-b", envelope)).toThrow(RockCryptoError);
  });

  it("won't open with another secret", () => {
    const envelope = sealRestKey(secret, "org-a", "key-for-a-only");
    expect(() => openRestKey(randomBytes(32), "org-a", envelope)).toThrow(RockCryptoError);
  });

  it("refuses a damaged envelope", () => {
    const [v, kid, iv, sealed] = sealRestKey(secret, "org-a", "key-for-a-only").split(".");
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
    expect(() => openRestKey(secret, "org-a", [v, kid, iv, flipped].join("."))).toThrow(RockCryptoError);
    expect(() => openRestKey(secret, "org-a", "plain text")).toThrow(RockCryptoError);
  });

  it("accepts only strict base64 of 32 bytes as the secret", () => {
    expect(parseRockSecret(secret.toString("base64"))).toEqual(secret);
    expect(parseRockSecret(undefined)).toBeNull();
    expect(parseRockSecret("short")).toBeNull();
    expect(parseRockSecret(randomBytes(16).toString("base64"))).toBeNull();
  });
});
