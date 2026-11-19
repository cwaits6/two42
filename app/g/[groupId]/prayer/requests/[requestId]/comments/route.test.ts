import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorHash, decryptBody, encryptBody, isAuthor, type PrayerKeys } from "@/lib/prayer/crypto";
import { COMMENT_TEXT_MAX } from "@/lib/prayer/comments";
import { newKey, testKeys } from "@/lib/prayer/testKeys";

const GROUP = "11111111-1111-4111-8111-111111111111";
const OTHER_GROUP = "11111111-1111-4111-8111-222222222222";
const ORG = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const ASKER = "44444444-4444-4444-8444-444444444444";
const WRITER = "55555555-5555-4555-8555-555555555555";
const MEMBER = "66666666-6666-4666-8666-666666666666";
const R_NAMED = "77777777-7777-4777-8777-000000000001";
const R_HASHED = "77777777-7777-4777-8777-000000000002";
const R_OTHER_GROUP = "77777777-7777-4777-8777-000000000003";
const R_OTHER_ORG = "77777777-7777-4777-8777-000000000004";
const C_NAMED = "88888888-8888-4888-8888-000000000001";
const C_HIDDEN = "88888888-8888-4888-8888-000000000002";
const C_ON_HASHED = "88888888-8888-4888-8888-000000000003";
const STAMP = "2026-01-01T00:00:00.000000+00:00";

type Row = Record<string, unknown>;
let user: { id: string } | null;
let role: "leader" | "member";
let env: Record<string, string>;
let keys: PrayerKeys;
let tables: Record<string, Row[]>;
let writes: { table: string; op: string; filters: string[]; values?: Row }[];
let deleteMatchesNothing: boolean;

function fakeService() {
  return {
    from(table: string) {
      expect(["prayer_requests", "prayer_comments"]).toContain(table);
      const predicates: ((row: Row) => boolean)[] = [];
      const filters: string[] = [];
      let op = "select";
      let values: Row | undefined;
      const chain = {
        select: () => chain,
        insert: (v: Row) => ((op = "insert"), (values = v), chain),
        delete: () => ((op = "delete"), chain),
        eq: (column: string, value: unknown) => {
          filters.push(column);
          predicates.push((row) => row[column] === value);
          return chain;
        },
        maybeSingle: async () => {
          writes.push({ table, op, filters });
          return { data: tables[table].find((r) => predicates.every((p) => p(r))) ?? null, error: null };
        },
        then(resolve: (value: unknown) => void) {
          writes.push({ table, op, filters, values });
          if (op === "insert") {
            tables[table].push({ ...values, created_at: STAMP });
            return resolve({ data: [{ id: values!.id, created_at: STAMP }], error: null });
          }
          const matched = deleteMatchesNothing ? [] : tables[table].filter((r) => predicates.every((p) => p(r)));
          tables[table] = tables[table].filter((r) => !matched.includes(r));
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
const { DELETE } = await import("./[commentId]/route");

const post = (body: unknown, requestId = R_NAMED, groupId = GROUP) =>
  POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ groupId, requestId }),
  });
const remove = (commentId: string, requestId = R_NAMED) =>
  DELETE(new Request("http://test", { method: "DELETE" }), {
    params: Promise.resolve({ groupId: GROUP, requestId, commentId }),
  });
const comments = () => tables.prayer_comments;
const has = (id: string) => comments().some((c) => c.id === id);

beforeEach(() => {
  user = { id: WRITER };
  role = "member";
  env = { PRAYER_BODY_KEY: newKey(), PRAYER_AUTHOR_KEY: newKey() };
  keys = testKeys(env);
  writes = [];
  deleteMatchesNothing = false;
  const request = { org_id: ORG, group_id: GROUP, is_anonymous: false, author_hash: null };
  tables = {
    prayer_requests: [
      { ...request, id: R_NAMED, author_id: ASKER },
      { ...request, id: R_HASHED, is_anonymous: true, author_id: null, author_hash: authorHash(keys, ORG, R_HASHED, ASKER) },
      { ...request, id: R_OTHER_GROUP, group_id: OTHER_GROUP, author_id: ASKER },
      { ...request, id: R_OTHER_ORG, org_id: OTHER_ORG, author_id: ASKER },
    ],
    prayer_comments: [
      { id: C_NAMED, org_id: ORG, request_id: R_NAMED, writer_id: WRITER, writer_hash: null },
      { id: C_HIDDEN, org_id: ORG, request_id: R_NAMED, writer_id: null, writer_hash: authorHash(keys, ORG, C_HIDDEN, WRITER) },
      { id: C_ON_HASHED, org_id: ORG, request_id: R_HASHED, writer_id: MEMBER, writer_hash: null },
    ],
  };
});

describe("posting a comment", () => {
  const draft = { body: "Praying for you.", only_asker: false, hide_name: false };

  it("refuses a signed-out caller, a group they are not in, and a server without keys", async () => {
    user = null;
    expect((await post(draft)).status).toBe(401);
    user = { id: WRITER };
    expect((await post(draft, R_NAMED, OTHER_GROUP)).status).toBe(404);
    env = {};
    expect((await post(draft)).status).toBe(503);
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it.each([
    ["empty text", { ...draft, body: "" }],
    ["text over the cap", { ...draft, body: "a".repeat(COMMENT_TEXT_MAX + 1) }],
    ["a missing choice", { body: "Praying." }],
  ])("refuses %s", async (_, body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("refuses a request in another group or church as missing", async () => {
    expect((await post(draft, R_OTHER_GROUP)).status).toBe(404);
    expect((await post(draft, R_OTHER_ORG)).status).toBe(404);
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it("stores a named comment with its writer and sealed text, and several from one person", async () => {
    await post(draft);
    await post({ ...draft, body: "And again.", only_asker: true });
    const added = comments().slice(3);
    expect(added).toHaveLength(2);
    const [first, second] = added;
    expect(first).toMatchObject({ org_id: ORG, request_id: R_NAMED, writer_id: WRITER, writer_hash: null, only_asker: false, hide_name: false });
    expect(second).toMatchObject({ only_asker: true });
    expect(first.body_ciphertext).not.toContain("Praying");
    expect(decryptBody(keys, ORG, first.id as string, first.body_ciphertext as string)).toBe("Praying for you.");
  });

  it("stores a hidden-name comment with only a hash of its writer", async () => {
    const res = await post({ ...draft, hide_name: true });
    const { id } = (await res.json()) as { id: string };
    const stored = comments().find((c) => c.id === id)!;
    expect(stored).toMatchObject({ writer_id: null, hide_name: true });
    expect(isAuthor(keys, ORG, id, WRITER, stored.writer_hash as string)).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(WRITER);
  });
});

describe("deleting a comment", () => {
  it("lets the writer delete their own, named or hidden", async () => {
    expect((await remove(C_NAMED)).status).toBe(200);
    expect((await remove(C_HIDDEN)).status).toBe(200);
    expect(has(C_NAMED) || has(C_HIDDEN)).toBe(false);
  });

  it("lets the person who asked delete any comment, on a by-name or an anonymous request", async () => {
    user = { id: ASKER };
    expect((await remove(C_HIDDEN)).status).toBe(200);
    expect((await remove(C_ON_HASHED, R_HASHED)).status).toBe(200);
  });

  it("lets a leader delete anyone's comment", async () => {
    user = { id: MEMBER };
    role = "leader";
    expect((await remove(C_HIDDEN)).status).toBe(200);
  });

  it("answers anyone else, and a comment on another request, as missing", async () => {
    user = { id: MEMBER };
    expect((await remove(C_NAMED)).status).toBe(404);
    expect((await remove(C_HIDDEN)).status).toBe(404);
    user = { id: WRITER };
    expect((await remove(C_ON_HASHED, R_NAMED)).status).toBe(404);
    expect(comments()).toHaveLength(3);
  });

  it("reports a delete that removed nothing as missing, not success", async () => {
    deleteMatchesNothing = true;
    expect((await remove(C_NAMED)).status).toBe(404);
  });
});

it("filters every read and write on the writer's church", async () => {
  await post({ body: "x", only_asker: false, hide_name: true });
  await remove(C_NAMED);
  for (const w of writes) {
    if (w.op === "insert") expect(w.values).toMatchObject({ org_id: ORG });
    else expect(w.filters).toContain("org_id");
  }
  expect(writes.length).toBeGreaterThan(3);
});

it("seals text so it opens only under its own comment id", () => {
  const sealed = encryptBody(keys, ORG, C_NAMED, "x");
  expect(() => decryptBody(keys, ORG, C_HIDDEN, sealed)).toThrow();
});
