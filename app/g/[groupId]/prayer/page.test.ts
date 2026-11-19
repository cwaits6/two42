import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { authorHash, encryptBody, type PrayerKeys } from "@/lib/prayer/crypto";
import { testKeys } from "@/lib/prayer/testKeys";

type Read = { data: unknown[] | null; error: { code: string; message: string } | null };
let reads: Record<string, Read>;
let calls: { table: string; method: string }[];
let role: "leader" | "member";
let keys: PrayerKeys | null;

function query(table: string) {
  const record = (method: string) => calls.push({ table, method });
  const chain: Record<string, unknown> = {
    then: (resolve: (r: Read) => unknown) => Promise.resolve(resolve(reads[table])),
    single: () => {
      record("single");
      return Promise.resolve({ data: { org_id: ORG, role: "member", first_name: "Ada" }, error: null });
    },
  };
  for (const method of ["select", "eq", "in", "order", "range", "returns", "insert", "update", "upsert", "delete"]) {
    chain[method] = () => {
      record(method);
      return chain;
    };
  }
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected");
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ from: (table: string) => query(`service:${table}`) }),
  createClient: async () => ({
    from: (table: string) => query(table),
    rpc: (fn: string) => {
      calls.push({ table: fn, method: "rpc" });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role }),
}));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrl: async () => null,
  mintSignedUrls: async (urls: unknown[]) => urls.map(() => null),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));
vi.mock("@/lib/prayer/keys", () => ({ loadPrayerKeys: () => keys }));

const { default: PrayerPage } = await import("./page");

async function render() {
  const element = (await PrayerPage({ params: Promise.resolve({ groupId: "g1" }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

const ORG = "11111111-1111-4111-8111-111111111111";
const serverKeys = testKeys();
const sealedRow = {
  id: "r3",
  org_id: ORG,
  group_id: "g1",
  body: null,
  body_ciphertext: encryptBody(serverKeys, ORG, "r3", "Pray for my mother's surgery."),
  is_anonymous: true,
  author_hash: authorHash(serverKeys, ORG, "r3", "u1"),
  is_answered: false,
  created_at: new Date().toISOString(),
  mine: false,
  praying_count: 0,
  i_am_praying: false,
};

const goodRow = {
  id: "r1",
  group_id: "g1",
  body: "Pray for a steady week.",
  is_anonymous: false,
  is_answered: false,
  created_at: new Date().toISOString(),
  mine: false,
  first_name: "Ada",
  last_name: "Author",
  preferred_name: null,
  avatar_url: null,
  praying_count: 2,
  i_am_praying: false,
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  calls = [];
  role = "member";
  keys = serverKeys;
  reads = {
    prayer_wall: { data: [goodRow], error: null },
    "service:prayer_comments": { data: [], error: null },
    profiles: { data: [], error: null },
  };
});

describe("PrayerPage", () => {
  it.each(["member", "leader"] as const)("renders the wall with no prayer call card, for a %s", async (who) => {
    role = who;
    const html = await render();
    expect(html).toContain("Pray for a steady week.");
    expect(html).not.toMatch(/prayer call/i);
  });

  it("reads only the wall, its comments and the viewer's profile, and writes nothing, so no event is deleted", async () => {
    role = "leader";
    await render();
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(["profiles", "prayer_wall", "service:prayer_comments"]));
    const writes = calls.filter((c) => ["insert", "update", "upsert", "delete", "rpc"].includes(c.method));
    expect(writes).toEqual([]);
  });

  it("renders a row with unexpected values next to a good one", async () => {
    reads.prayer_wall.data = [
      goodRow,
      {
        id: "r2",
        body: null,
        is_anonymous: "maybe",
        created_at: "yesterday-ish",
        mine: null,
        praying_count: "lots",
        i_am_praying: null,
        category: "Health",
      },
    ];
    const html = await render();
    expect(html).toContain("Pray for a steady week.");
    expect(html).toContain("2 shown");
  });

  it("shows the error state, not a crash, when the requests can't be read", async () => {
    reads.prayer_wall = { data: null, error: { code: "57014", message: "canceling statement" } };
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load prayer requests.");
    expect(html).not.toContain("Share a request");
  });

  it("opens sealed text, and shows the viewer their own anonymous request as theirs", async () => {
    reads.prayer_wall.data = [goodRow, sealedRow];
    const html = await render();
    expect(html).toContain("Pray for my mother&#x27;s surgery.");
    expect(html).toContain("2 shown");
    expect(html.match(/>You</g)).toHaveLength(1);
    expect(html).not.toContain(sealedRow.body_ciphertext);
    expect(html).not.toContain(sealedRow.author_hash);
  });

  it.each([
    ["missing", () => null],
    ["wrong", () => testKeys()],
  ])("shows the error state, never ciphertext or an empty wall, when the key is %s", async (_, key) => {
    keys = key();
    reads.prayer_wall.data = [goodRow, sealedRow];
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load prayer requests.");
    expect(html).not.toContain("Pray for a steady week.");
    expect(html).not.toContain("v1.");
    expect(html).not.toContain("No prayer requests yet.");
  });

  describe("comments", () => {
    const comment = (id: string, request: string, opts: { privately?: boolean; hidden?: boolean; writer?: string } = {}) => ({
      id,
      request_id: request,
      body_ciphertext: encryptBody(serverKeys, ORG, id, `Comment ${id}`),
      only_asker: opts.privately ?? false,
      hide_name: opts.hidden ?? false,
      writer_id: opts.hidden ? null : (opts.writer ?? "u2"),
      writer_hash: opts.hidden ? authorHash(serverKeys, ORG, id, opts.writer ?? "u2") : null,
      created_at: new Date().toISOString(),
    });

    it("shows group comments with their writer, and someone else's private comment to no one else", async () => {
      reads["service:prayer_comments"].data = [
        comment("c1", "r1"),
        comment("c2", "r1", { privately: true }),
        comment("c3", "r1", { hidden: true }),
      ];
      reads.profiles.data = [{ id: "u2", first_name: "Ben", last_name: "Writer", preferred_name: null }];
      const html = await render();
      expect(html).toContain("Comment c1");
      expect(html).toContain("Ben Writer");
      expect(html).toContain("Comment c3");
      expect(html).not.toContain("Comment c2");
      expect(html).not.toContain("u2");
    });

    it("shows a private comment on the viewer's own anonymous request", async () => {
      reads.prayer_wall.data = [sealedRow];
      reads["service:prayer_comments"].data = [comment("c4", "r3", { privately: true })];
      expect(await render()).toContain("Comment c4");
    });

    it("still shows the wall, without comments, when they can't be read", async () => {
      reads["service:prayer_comments"] = { data: null, error: { code: "42P01", message: "missing" } };
      const html = await render();
      expect(html).toContain("Pray for a steady week.");
      expect(html).toContain("Comments couldn&#x27;t load.");
    });

    it("shows the error state when a comment's text fails to open", async () => {
      reads["service:prayer_comments"].data = [{ ...comment("c5", "r1"), body_ciphertext: "v1.bad.bad.bad" }];
      const html = await render();
      expect(html).toContain("Couldn&#x27;t load prayer requests.");
      expect(html).not.toContain("Pray for a steady week.");
    });
  });
});
