/**
 * A key sealed once by the app with sealKey(). The app's tests and the edge
 * functions' tests both open it, so a change on either side that would leave
 * the nightly refresh unable to open the keys the app saves fails both.
 */
export const RECORDS_CRYPTO_VECTOR = {
  secret: "dHdvNDIgcmVjb3JkcyB0ZXN0IHZlY3RvciBzZWNyZXQ=",
  orgId: "7c0d3a52-5b6e-4f1a-9d2c-1e8f4a6b9c01",
  provider: "rock",
  envelope: "k1.82cde092.GnckWEab_O9HgTfx.pdpMygyuYFxzSTF7ZmwOThGFs7wcZbgO0I26EMVUTKaic5xclbs",
  key: "TestKey-1234567890abcd",
} as const;
