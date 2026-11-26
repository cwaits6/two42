import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { openKey, parseRecordsSecret, RecordsCryptoError, sealKey } from "../_shared/records-crypto.ts";
import { RECORDS_CRYPTO_VECTOR as V } from "../_shared/records-crypto-vector.ts";

const secret = parseRecordsSecret(V.secret)!;

Deno.test("the edge functions open a key the app sealed", () => {
  assertEquals(openKey(secret, V.orgId, V.provider, V.envelope), V.key);
});

Deno.test("the key won't open for another church", () => {
  assertThrows(() => openKey(secret, "00000000-0000-0000-0000-000000000002", V.provider, V.envelope), RecordsCryptoError);
});

Deno.test("a key sealed here opens here", () => {
  assertEquals(openKey(secret, V.orgId, V.provider, sealKey(secret, V.orgId, V.provider, "another")), "another");
});
