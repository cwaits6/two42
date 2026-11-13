import { describe, expect, it } from "vitest";
import {
  authorHash,
  authorKeyProven,
  decryptBody,
  encryptBody,
  isAuthor,
  parsePrayerKeys,
  planRow,
  storedForm,
  type StoredRow,
  writesAuthorHash,
} from "./crypto";
import { newKey, testKeys } from "./testKeys";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER_ORG = "22222222-2222-2222-2222-222222222222";
const REQ = "33333333-3333-3333-3333-333333333333";
const OTHER_REQ = "44444444-4444-4444-4444-444444444444";
const ADA = "55555555-5555-5555-5555-555555555555";
const BEN = "66666666-6666-6666-6666-666666666666";

describe("parsePrayerKeys", () => {
  it("needs both keys, each exactly 32 bytes of base64", () => {
    const body = newKey();
    const author = newKey();
    expect(parsePrayerKeys({ PRAYER_BODY_KEY: body, PRAYER_AUTHOR_KEY: author })).not.toBeNull();
    expect(parsePrayerKeys({ PRAYER_BODY_KEY: body })).toBeNull();
    expect(parsePrayerKeys({ PRAYER_AUTHOR_KEY: author })).toBeNull();
    expect(parsePrayerKeys({ PRAYER_BODY_KEY: body, PRAYER_AUTHOR_KEY: "" })).toBeNull();
    expect(parsePrayerKeys({ PRAYER_BODY_KEY: body, PRAYER_AUTHOR_KEY: Buffer.alloc(16).toString("base64") })).toBeNull();
    expect(parsePrayerKeys({ PRAYER_BODY_KEY: body, PRAYER_AUTHOR_KEY: "not base64 at all!" })).toBeNull();
  });

  it("refuses a previous key that is set but malformed", () => {
    const env = { PRAYER_BODY_KEY: newKey(), PRAYER_AUTHOR_KEY: newKey() };
    expect(parsePrayerKeys({ ...env, PRAYER_BODY_KEY_PREVIOUS: "short" })).toBeNull();
    expect(parsePrayerKeys({ ...env, PRAYER_AUTHOR_KEY_PREVIOUS: "short" })).toBeNull();
    expect(parsePrayerKeys({ ...env, PRAYER_BODY_KEY_PREVIOUS: newKey() })?.body.previous).not.toBeNull();
  });
});

describe("prayer text", () => {
  const keys = testKeys();

  it("opens what it sealed, at the longest length a request allows", () => {
    const text = "é".repeat(1999) + "🙏";
    const sealed = encryptBody(keys, ORG, REQ, text);
    expect(sealed).not.toContain("é");
    expect(decryptBody(keys, ORG, REQ, sealed)).toBe(text);
  });

  it("seals the same text differently each time", () => {
    expect(encryptBody(keys, ORG, REQ, "same")).not.toBe(encryptBody(keys, ORG, REQ, "same"));
  });

  it("refuses another key, a damaged envelope, and text moved to another row or church", () => {
    const sealed = encryptBody(keys, ORG, REQ, "Pray for a steady week.");
    expect(() => decryptBody(testKeys(), ORG, REQ, sealed)).toThrow();
    const [v, kid, iv, ct] = sealed.split(".");
    const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(() => decryptBody(keys, ORG, REQ, [v, kid, iv, flipped].join("."))).toThrow();
    expect(() => decryptBody(keys, ORG, OTHER_REQ, sealed)).toThrow();
    expect(() => decryptBody(keys, OTHER_ORG, REQ, sealed)).toThrow();
    expect(() => decryptBody(keys, ORG, REQ, "Pray for a steady week.")).toThrow();
  });

  it("opens text under the previous key while a rotation is under way", () => {
    const old = testKeys();
    const sealed = encryptBody(old, ORG, REQ, "kept");
    const rotating = parsePrayerKeys({
      PRAYER_BODY_KEY: newKey(),
      PRAYER_BODY_KEY_PREVIOUS: old.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newKey(),
    })!;
    expect(decryptBody(rotating, ORG, REQ, sealed)).toBe("kept");
  });
});

describe("author hash", () => {
  const keys = testKeys();

  it("shares no value between two requests by one person", () => {
    expect(authorHash(keys, ORG, REQ, ADA)).not.toBe(authorHash(keys, ORG, OTHER_REQ, ADA));
    expect(authorHash(keys, ORG, REQ, ADA)).not.toContain(ADA);
  });

  it("recognises the author and no one else, in this church and on this request only", () => {
    const hash = authorHash(keys, ORG, REQ, ADA);
    expect(isAuthor(keys, ORG, REQ, ADA, hash)).toBe(true);
    expect(isAuthor(keys, ORG, REQ, BEN, hash)).toBe(false);
    expect(isAuthor(keys, ORG, OTHER_REQ, ADA, hash)).toBe(false);
    expect(isAuthor(keys, OTHER_ORG, REQ, ADA, hash)).toBe(false);
    expect(isAuthor(testKeys(), ORG, REQ, ADA, hash)).toBe(false);
    expect(isAuthor(keys, ORG, REQ, ADA, "garbage")).toBe(false);
  });

  it("recognises a hash under the previous key", () => {
    const old = testKeys();
    const hash = authorHash(old, ORG, REQ, ADA);
    const rotating = parsePrayerKeys({
      PRAYER_BODY_KEY: newKey(),
      PRAYER_AUTHOR_KEY: newKey(),
      PRAYER_AUTHOR_KEY_PREVIOUS: old.author.current.toString("base64"),
    })!;
    expect(isAuthor(rotating, ORG, REQ, ADA, hash)).toBe(true);
  });
});

describe("storedForm", () => {
  const keys = testKeys();
  const row = { id: REQ, orgId: ORG, text: "Pray for Ada." };

  it("stores a by-name request with its author and no hash", () => {
    const form = storedForm(keys, { ...row, author: { anonymous: false, authorId: ADA } });
    expect(form).toMatchObject({ body: null, is_anonymous: false, author_id: ADA, author_hash: null });
    expect(decryptBody(keys, ORG, REQ, form.body_ciphertext)).toBe("Pray for Ada.");
  });

  it("stores an anonymous request with a hash and no author", () => {
    const form = storedForm(keys, { ...row, author: { anonymous: true, authorId: ADA } });
    expect(form).toMatchObject({ body: null, is_anonymous: true, author_id: null });
    expect(isAuthor(keys, ORG, REQ, ADA, form.author_hash!)).toBe(true);
    expect(JSON.stringify(form)).not.toContain(ADA);
    expect(JSON.stringify(form)).not.toContain("Pray for Ada.");
  });

  it("keeps a hash it is handed, for a write by someone who is not the author", () => {
    const hash = authorHash(keys, ORG, REQ, ADA);
    expect(storedForm(keys, { ...row, author: { anonymous: true, authorHash: hash } }).author_hash).toBe(hash);
  });
});

describe("planRow", () => {
  const keys = testKeys();
  const legacy = (extra: Partial<StoredRow> = {}): StoredRow => ({
    id: REQ,
    org_id: ORG,
    body: "Pray for Ada.",
    body_ciphertext: null,
    is_anonymous: false,
    author_id: ADA,
    author_hash: null,
    ...extra,
  });
  const converge = (row: StoredRow, plan: ReturnType<typeof planRow>): StoredRow =>
    plan.action === "write" ? { ...row, ...plan.patch } : row;

  it("encrypts a by-name row and keeps its author", () => {
    const plan = planRow(legacy(), keys);
    expect(plan).toMatchObject({ action: "write", steps: ["encrypt"], patch: { body: null, author_id: ADA, author_hash: null } });
    const after = converge(legacy(), plan);
    expect(decryptBody(keys, ORG, REQ, after.body_ciphertext!)).toBe("Pray for Ada.");
    expect(planRow(after, keys)).toEqual({ action: "noop" });
  });

  it("encrypts an anonymous row and replaces its author with the hash", () => {
    const row = legacy({ is_anonymous: true });
    const plan = planRow(row, keys);
    expect(plan).toMatchObject({ action: "write", steps: ["encrypt", "hash"], patch: { author_id: null } });
    const after = converge(row, plan);
    expect(isAuthor(keys, ORG, REQ, ADA, after.author_hash!)).toBe(true);
    expect(planRow(after, keys)).toEqual({ action: "noop" });
  });

  it("moves text and hash off the previous keys, finding the author among the members", () => {
    const old = testKeys();
    const row = converge(legacy({ is_anonymous: true }), planRow(legacy({ is_anonymous: true }), old));
    const rotating = parsePrayerKeys({
      PRAYER_BODY_KEY: newKey(),
      PRAYER_BODY_KEY_PREVIOUS: old.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newKey(),
      PRAYER_AUTHOR_KEY_PREVIOUS: old.author.current.toString("base64"),
    })!;
    const plan = planRow(row, rotating, [BEN, ADA]);
    expect(plan).toMatchObject({ action: "write", steps: ["reencrypt", "rehash"] });
    const after = converge(row, plan);
    const current = parsePrayerKeys({
      PRAYER_BODY_KEY: rotating.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: rotating.author.current.toString("base64"),
    })!;
    expect(decryptBody(current, ORG, REQ, after.body_ciphertext!)).toBe("Pray for Ada.");
    expect(isAuthor(current, ORG, REQ, ADA, after.author_hash!)).toBe(true);
    expect(planRow(after, current)).toEqual({ action: "noop" });
  });

  it("reports a stale hash that matches no member, and text it cannot open", () => {
    const old = testKeys();
    const row = converge(legacy({ is_anonymous: true }), planRow(legacy({ is_anonymous: true }), old));
    const rotating = parsePrayerKeys({
      PRAYER_BODY_KEY: old.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newKey(),
      PRAYER_AUTHOR_KEY_PREVIOUS: old.author.current.toString("base64"),
    })!;
    expect(planRow(row, rotating, [BEN])).toEqual({ action: "unmatched" });
    expect(planRow(row, testKeys())).toEqual({ action: "error" });
  });

  it("still moves the text off the previous body key when an old hash matches no one", () => {
    const first = testKeys();
    const row = converge(legacy({ is_anonymous: true }), planRow(legacy({ is_anonymous: true }), first));
    const newAuthorKey = newKey();
    // An earlier author rotation left this request unmatched; this is the later body rotation.
    const rotatingBody = parsePrayerKeys({
      PRAYER_BODY_KEY: newKey(),
      PRAYER_BODY_KEY_PREVIOUS: first.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newAuthorKey,
    })!;
    const plan = planRow(row, rotatingBody, []);
    expect(plan).toMatchObject({ action: "write", steps: ["reencrypt"], unmatched: true });
    const after = converge(row, plan);
    expect(after.author_hash).toBe(row.author_hash);
    const current = parsePrayerKeys({
      PRAYER_BODY_KEY: rotatingBody.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newAuthorKey,
    })!;
    expect(decryptBody(current, ORG, REQ, after.body_ciphertext!)).toBe("Pray for Ada.");
    expect(planRow(after, current)).toEqual({ action: "unmatched" });
  });
});

describe("the backfill's author key proof", () => {
  const right = testKeys();
  const hashed: StoredRow = storedFormRow(right, OTHER_REQ, BEN);
  const legacy = (extra: Partial<StoredRow> = {}): StoredRow => ({
    id: REQ,
    org_id: ORG,
    body: "Pray for Ada.",
    body_ciphertext: null,
    is_anonymous: true,
    author_id: ADA,
    author_hash: null,
    ...extra,
  });
  const otherKey = (previous?: Buffer) =>
    parsePrayerKeys({
      PRAYER_BODY_KEY: right.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: newKey(),
      ...(previous ? { PRAYER_AUTHOR_KEY_PREVIOUS: previous.toString("base64") } : {}),
    })!;

  function storedFormRow(keys: ReturnType<typeof testKeys>, id: string, authorId: string): StoredRow {
    const form = storedForm(keys, { id, orgId: ORG, text: "Pray for Ben.", author: { anonymous: true, authorId } });
    return { id, org_id: ORG, ...form };
  }

  it("is a hash under the given current author key, and nothing else", () => {
    expect(authorKeyProven(right, [legacy(), hashed])).toBe(true);
    expect(authorKeyProven(right, [legacy()])).toBe(false);
    expect(authorKeyProven(otherKey(), [legacy(), hashed])).toBe(false);
    expect(authorKeyProven(otherKey(right.author.current), [legacy(), hashed])).toBe(false);
  });

  it("is needed to hash a legacy anonymous request or move a hash onto a new author key", () => {
    expect(writesAuthorHash(planRow(legacy(), right))).toBe(true);
    const rotating = otherKey(right.author.current);
    expect(writesAuthorHash(planRow(hashed, rotating, [BEN]))).toBe(true);
  });

  it("is not needed to seal by-name text, or to move text onto a new body key past a lost author key", () => {
    const named = legacy({ is_anonymous: false });
    expect(planRow(named, right)).toMatchObject({ action: "write", steps: ["encrypt"] });
    expect(writesAuthorHash(planRow(named, right))).toBe(false);

    const lostAuthorKey = otherKey();
    const newBodyKey = parsePrayerKeys({
      PRAYER_BODY_KEY: newKey(),
      PRAYER_BODY_KEY_PREVIOUS: right.body.current.toString("base64"),
      PRAYER_AUTHOR_KEY: lostAuthorKey.author.current.toString("base64"),
    })!;
    const plan = planRow(hashed, newBodyKey);
    expect(plan).toMatchObject({ action: "write", steps: ["reencrypt"], unmatched: true });
    expect(writesAuthorHash(plan)).toBe(false);
  });
});
