import { describe, expect, it } from "vitest";
import { RECORDS_CRYPTO_VECTOR as V } from "@/supabase/functions/_shared/records-crypto-vector";
import { openKey, parseRecordsSecret, RecordsCryptoError } from "./crypto";

describe("the sealed key the edge functions open", () => {
  const secret = { current: parseRecordsSecret(V.secret)!, previous: null };

  it("opens in the app", () => {
    expect(openKey(secret, V.orgId, V.provider, V.envelope)).toBe(V.key);
  });

  it("won't open for another church", () => {
    expect(() => openKey(secret, "00000000-0000-0000-0000-000000000002", V.provider, V.envelope)).toThrow(RecordsCryptoError);
  });
});
