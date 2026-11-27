import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { Buffer } from "node:buffer";
import {
  openKey,
  parseRecordsSecret,
  parseRecordsSecrets,
  RecordsCryptoError,
  sealKey,
} from "../_shared/records-crypto.ts";
import { RECORDS_CRYPTO_VECTOR as V } from "../_shared/records-crypto-vector.ts";

const vectorSecret = parseRecordsSecret(V.secret)!;
const secret = { current: vectorSecret, previous: null };
const other = Buffer.alloc(32, 7);

Deno.test("the edge functions open a key the app sealed", () => {
  assertEquals(openKey(secret, V.orgId, V.provider, V.envelope), V.key);
});

Deno.test("the key won't open for another church", () => {
  assertThrows(() => openKey(secret, "00000000-0000-0000-0000-000000000002", V.provider, V.envelope), RecordsCryptoError);
});

Deno.test("a key sealed here opens here", () => {
  assertEquals(openKey(secret, V.orgId, V.provider, sealKey(secret, V.orgId, V.provider, "another")), "another");
});

Deno.test("a key the app sealed under the previous secret opens during a rotation", () => {
  assertEquals(openKey({ current: other, previous: vectorSecret }, V.orgId, V.provider, V.envelope), V.key);
});

Deno.test("a key neither secret sealed won't open", () => {
  assertThrows(
    () => openKey({ current: other, previous: Buffer.alloc(32, 9) }, V.orgId, V.provider, V.envelope),
    RecordsCryptoError,
  );
});

Deno.test("a malformed previous secret turns the secrets off", () => {
  const env: Record<string, string> = { RECORDS_KEY_SECRET: V.secret, RECORDS_KEY_SECRET_PREVIOUS: "not-a-key" };
  assertEquals(parseRecordsSecrets((name) => env[name]), { secrets: null, malformed: "RECORDS_KEY_SECRET_PREVIOUS" });
});
