import { describe, expect, it } from "vitest";
import { authorHash, encryptBody } from "./crypto";
import { testKeys } from "./testKeys";
import { openWallRows } from "./wall";

const ORG = "11111111-1111-1111-1111-111111111111";
const ADA = "55555555-5555-5555-5555-555555555555";
const BEN = "66666666-6666-6666-6666-666666666666";
const keys = testKeys();

function raw(id: string, extra: Record<string, unknown>) {
  return { id, org_id: ORG, group_id: "g1", is_anonymous: false, is_answered: false, mine: false, body: null, ...extra };
}

describe("openWallRows", () => {
  const rows = [
    raw("r1", { body: "A row not yet converted." }),
    raw("r2", { body_ciphertext: encryptBody(keys, ORG, "r2", "Sealed by name."), mine: true }),
    raw("r3", {
      is_anonymous: true,
      body_ciphertext: encryptBody(keys, ORG, "r3", "Sealed, anonymous."),
      author_hash: authorHash(keys, ORG, "r3", ADA),
    }),
  ];

  it("opens the text, and recognises the viewer's own anonymous request", () => {
    const opened = openWallRows(rows, { viewerId: ADA, keys });
    expect(opened.map((r) => [r.body, r.mine])).toEqual([
      ["A row not yet converted.", false],
      ["Sealed by name.", true],
      ["Sealed, anonymous.", true],
    ]);
  });

  it("does not mark another member's anonymous request as theirs", () => {
    expect(openWallRows(rows, { viewerId: BEN, keys })[2].mine).toBe(false);
  });

  it("returns no ciphertext or hash", () => {
    const json = JSON.stringify(openWallRows(rows, { viewerId: ADA, keys }));
    expect(json).not.toContain("v1.");
    expect(json).not.toContain("h1.");
  });

  it("throws on a wrong key rather than showing anything", () => {
    expect(() => openWallRows(rows, { viewerId: ADA, keys: testKeys() })).toThrow();
  });
});
