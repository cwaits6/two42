import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorHash, decryptBody, encryptBody, isAuthor, type PrayerKeys } from "@/lib/prayer/crypto";
import { newKey, testKeys } from "@/lib/prayer/testKeys";

const GROUP = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const ADA = "44444444-4444-4444-8444-444444444444";
const BEN = "55555555-5555-4555-8555-555555555555";
const LEADER = "66666666-6666-4666-8666-666666666666";
const R_NAMED = "77777777-7777-4777-8777-000000000001";
const R_HASHED = "77777777-7777-4777-8777-000000000002";
const R_LEGACY = "77777777-7777-4777-8777-000000000003";
const R_OTHER_ORG = "77777777-7777-4777-8777-000000000004";
const STAMP = "2026-01-01T00:00:00.000000+00:00";

type Row = Record<string, unknown>;
let user: { id: string } | null;
let role: "leader" | "member";
let env: Record<string, string>;
let keys: PrayerKeys;
let rows: Row[];
let writes: { op: string; filters: string[]; values?: Row }[];
let beforeWrite: () => void;

function fakeService() {
  return {
    from(table: string) {
      expect(table).toBe("prayer_requests");
      const predicates: ((row: Row) => boolean)[] = [];
      const filters: string[] = [];
      let op = "select";
      let values: Row | undefined;
      const chain = {
        select: () => chain,
        insert: (v: Row) => ((op = "insert"), (values = v), chain),
        update: (v: Row) => ((op = "update"), (values = v), chain),
        delete: () => ((op = "delete"), chain),
        eq: (column: string, value: unknown) => {
          filters.push(column);
          predicates.push((row) => row[column] === value);
          return chain;
        },
        maybeSingle: async () => ({ data: rows.find((r) => predicates.every((p) => p(r))) ?? null, error: null }),
        then(resolve: (value: unknown) => void) {
          writes.push({ op, filters, values });
          if (op !== "select") beforeWrite();
          if (op === "insert") {
            const row: Row = { ...values, created_at: STAMP, updated_at: STAMP };
            rows.push(row);
            return resolve({ data: [{ id: row.id, created_at: STAMP }], error: null });
          }
          const matched = rows.filter((r) => predicates.every((p) => p(r)));
          if (op === "update") matched.forEach((r) => Object.assign(r, values));
          if (op === "delete") rows = rows.filter((r) => !matched.includes(r));
          resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: ORG }, error: null }) }) }) }),
  }),
  createServiceClient: async () => fakeService(),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => user }));
vi.mock("@/lib/groups/server", () => ({
  getGroupMemberships: async () => [{ id: GROUP, name: "Grace", color: null, role }],
}));
vi.mock("@/lib/prayer/keys", async () => {
  const { parsePrayerKeys } = await import("@/lib/prayer/crypto");
  return { loadPrayerKeys: () => parsePrayerKeys(env) };
});
vi.spyOn(console, "log").mockImplementation(() => {});

const { POST } = await import("./route");
const { PATCH, DELETE } = await import("./[requestId]/route");

const post = (body: unknown, groupId = GROUP) =>
  POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ groupId }) });
const patch = (requestId: string, body: unknown) =>
  PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ groupId: GROUP, requestId }),
  });
const remove = (requestId: string) =>
  DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ groupId: GROUP, requestId }) });
const row = (id: string) => rows.find((r) => r.id === id)!;
const text = (r: Row) => decryptBody(keys, r.org_id as string, r.id as string, r.body_ciphertext as string);

beforeEach(() => {
  user = { id: ADA };
  role = "member";
  env = { PRAYER_BODY_KEY: newKey(), PRAYER_AUTHOR_KEY: newKey() };
  keys = testKeys(env);
  writes = [];
  beforeWrite = () => {};
  const base = { org_id: ORG, group_id: GROUP, is_answered: false, updated_at: STAMP, body: null };
  rows = [
    { ...base, id: R_NAMED, is_anonymous: false, author_id: ADA, author_hash: null, body_ciphertext: encryptBody(keys, ORG, R_NAMED, "Named") },
    {
      ...base,
      id: R_HASHED,
      is_anonymous: true,
      author_id: null,
      author_hash: authorHash(keys, ORG, R_HASHED, ADA),
      body_ciphertext: encryptBody(keys, ORG, R_HASHED, "Hashed"),
    },
    { ...base, id: R_LEGACY, is_anonymous: true, author_id: ADA, author_hash: null, body: "Legacy", body_ciphertext: null },
    { ...base, id: R_OTHER_ORG, org_id: OTHER_ORG, is_anonymous: false, author_id: ADA, author_hash: null, body: "Elsewhere", body_ciphertext: null },
  ];
});

describe("who may write", () => {
  it("refuses a signed-out caller, a group they are not in, and a server without keys", async () => {
    user = null;
    expect((await post({ body: "x", is_anonymous: false })).status).toBe(401);
    user = { id: ADA };
    expect((await post({ body: "x", is_anonymous: false }, "99999999-9999-4999-8999-999999999999")).status).toBe(404);
    expect((await post({ body: "x", is_anonymous: false }, "not-a-uuid")).status).toBe(404);
    env = { PRAYER_BODY_KEY: newKey() };
    expect((await post({ body: "x", is_anonymous: false })).status).toBe(503);
    expect((await patch(R_NAMED, { is_answered: true })).status).toBe(503);
    expect((await remove(R_NAMED)).status).toBe(503);
    expect(writes).toEqual([]);
  });

  it("refuses text the table would have refused", async () => {
    for (const body of ["", "x".repeat(2001), 42, null]) {
      expect((await post({ body, is_anonymous: false })).status).toBe(400);
    }
    expect((await post({ body: "x" })).status).toBe(400);
    expect((await post({ body: "🙏".repeat(2000), is_anonymous: false })).status).toBe(200);
  });
});

describe("posting", () => {
  it("stores an anonymous request as sealed text and a hash, with no author", async () => {
    const res = await post({ body: "Pray for my mother.", is_anonymous: true });
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const stored = row(id);
    expect(stored).toMatchObject({ org_id: ORG, group_id: GROUP, is_anonymous: true, author_id: null, body: null });
    expect(JSON.stringify(stored)).not.toContain("Pray for my mother.");
    expect(JSON.stringify(stored)).not.toContain(ADA);
    expect(text(stored)).toBe("Pray for my mother.");
    expect(isAuthor(keys, ORG, id, ADA, stored.author_hash as string)).toBe(true);
  });

  it("stores a by-name request with its author", async () => {
    const { id } = await (await post({ body: "Named.", is_anonymous: false })).json();
    expect(row(id)).toMatchObject({ is_anonymous: false, author_id: ADA, author_hash: null, body: null });
  });
});

describe("editing", () => {
  it("lets the author of a hashed request mark it answered, and stamps the change", async () => {
    expect((await patch(R_HASHED, { is_answered: true })).status).toBe(200);
    expect(row(R_HASHED)).toMatchObject({ is_answered: true, author_id: null });
    expect(row(R_HASHED).updated_at).not.toBe(STAMP);
    expect(text(row(R_HASHED))).toBe("Hashed");
  });

  it("switches by-name to anonymous and back, writing one author form and clearing the other", async () => {
    expect((await patch(R_NAMED, { is_anonymous: true })).status).toBe(200);
    expect(row(R_NAMED)).toMatchObject({ is_anonymous: true, author_id: null });
    expect(isAuthor(keys, ORG, R_NAMED, ADA, row(R_NAMED).author_hash as string)).toBe(true);
    expect((await patch(R_NAMED, { is_anonymous: false })).status).toBe(200);
    expect(row(R_NAMED)).toMatchObject({ is_anonymous: false, author_id: ADA, author_hash: null });
    expect(text(row(R_NAMED))).toBe("Named");
  });

  it("converts a row not yet converted on any write", async () => {
    expect((await patch(R_LEGACY, { body: "Edited." })).status).toBe(200);
    expect(row(R_LEGACY)).toMatchObject({ body: null, author_id: null, is_anonymous: true });
    expect(text(row(R_LEGACY))).toBe("Edited.");
    expect(isAuthor(keys, ORG, R_LEGACY, ADA, row(R_LEGACY).author_hash as string)).toBe(true);
  });

  it("lets a leader mark someone's anonymous request answered, keeping its hash, but not unmask it", async () => {
    user = { id: LEADER };
    role = "leader";
    const hash = row(R_HASHED).author_hash;
    expect((await patch(R_HASHED, { is_answered: true })).status).toBe(200);
    expect(row(R_HASHED)).toMatchObject({ is_answered: true, author_hash: hash, author_id: null });
    expect((await patch(R_HASHED, { is_anonymous: false })).status).toBe(403);
    expect((await patch(R_NAMED, { is_anonymous: true })).status).toBe(403);
    expect(row(R_HASHED).is_anonymous).toBe(true);
  });

  it("gives another member the same answer as a request that does not exist", async () => {
    user = { id: BEN };
    expect((await patch(R_HASHED, { is_answered: true })).status).toBe(404);
    expect((await patch(R_NAMED, { is_answered: true })).status).toBe(404);
    expect((await remove(R_HASHED)).status).toBe(404);
    expect((await patch(R_OTHER_ORG, { is_answered: true })).status).toBe(404);
    expect(writes.filter((w) => w.op !== "select")).toEqual([]);
  });

  it("refuses a write that read the row before someone else changed it", async () => {
    beforeWrite = () => {
      row(R_NAMED).updated_at = "2026-01-02T00:00:00.000000+00:00";
    };
    expect((await patch(R_NAMED, { is_answered: true })).status).toBe(409);
    expect(row(R_NAMED).is_answered).toBe(false);
  });

  it("refuses an empty or malformed edit", async () => {
    expect((await patch(R_NAMED, {})).status).toBe(400);
    expect((await patch(R_NAMED, { is_answered: "yes" })).status).toBe(400);
    expect((await patch(R_NAMED, { body: "" })).status).toBe(400);
    expect((await patch("not-a-uuid", { is_answered: true })).status).toBe(404);
  });
});

describe("deleting", () => {
  it("lets the author delete their hashed request, and a leader delete anyone's", async () => {
    expect((await remove(R_HASHED)).status).toBe(200);
    expect(rows.some((r) => r.id === R_HASHED)).toBe(false);
    user = { id: LEADER };
    role = "leader";
    expect((await remove(R_NAMED)).status).toBe(200);
  });
});

describe("tenancy", () => {
  it("scopes every service read and write to the caller's church and group", async () => {
    await post({ body: "x", is_anonymous: true });
    await patch(R_HASHED, { is_answered: true });
    await remove(R_HASHED);
    for (const w of writes) {
      if (w.op === "insert") expect(w.values).toMatchObject({ org_id: ORG, group_id: GROUP });
      else expect(w.filters).toEqual(expect.arrayContaining(["org_id", "group_id", "id"]));
    }
  });
});
