// Unit tests for the giving helpers. signStewardAvatars: unlike the
// named-slot reassembly in components/directory/useDirectoryData.ts, this
// helper uses fixed 2-slot stride arithmetic (i * 2 / i * 2 + 1) — the risk
// being guarded against is that stride drifts out of sync with the flatten
// if a third avatar field is ever added. The query helpers: each takes its
// Supabase client as a parameter, which is untyped as to privilege, so a
// recording fake asserts that every chain filters on the orgId it was given.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: Array<string | null | undefined>) =>
    urls.map((u) => (u ? `signed:${u}` : null)),
}));

const { getGivingSettings, givingStewardsCanManage, loadFundFormData, signStewardAvatars } =
  await import("@/lib/giving/server");

interface Call {
  table: string;
  filters: [string, string, unknown][];
}

/** Records every filter on every chain; resolves the scripted rows. */
function fakeClient(rowsByTable: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const rows = rowsByTable[table] ?? [];
      const chain = {
        select: () => chain,
        order: () => chain,
        eq(column: string, value: unknown) {
          call.filters.push(["eq", column, value]);
          return chain;
        },
        in(column: string, value: unknown) {
          call.filters.push(["in", column, value]);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ORG = "org-1";

describe("givingStewardsCanManage", () => {
  it("reads the setting scoped on the org and the key", async () => {
    const { client, calls } = fakeClient({ site_settings: [{ value: "admins" }] });
    expect(await givingStewardsCanManage(client, ORG)).toBe(false);
    expect(calls[0].table).toBe("site_settings");
    expect(calls[0].filters).toEqual([
      ["eq", "org_id", ORG],
      ["eq", "key", "giving_manage_mode"],
    ]);
  });

  it("defaults to stewards when the org has no row", async () => {
    const { client } = fakeClient();
    expect(await givingStewardsCanManage(client, ORG)).toBe(true);
  });
});

describe("getGivingSettings", () => {
  it("reads both keys in one query scoped on the org", async () => {
    const { client, calls } = fakeClient({
      site_settings: [
        { key: "giving_manage_mode", value: "admins" },
        { key: "giving_dashboard_tile", value: "off" },
      ],
    });
    expect(await getGivingSettings(client, ORG)).toEqual({
      stewardsCanManage: false,
      dashboardTile: false,
    });
    expect(calls[0].filters).toEqual([
      ["eq", "org_id", ORG],
      ["in", "key", ["giving_manage_mode", "giving_dashboard_tile"]],
    ]);
  });

  it("applies both defaults when the org has no rows", async () => {
    const { client } = fakeClient();
    expect(await getGivingSettings(client, ORG)).toEqual({
      stewardsCanManage: true,
      dashboardTile: true,
    });
  });
});

describe("loadFundFormData", () => {
  it("reads the member directory scoped on the org and signs each avatar", async () => {
    const { client, calls } = fakeClient({
      profiles_directory: [
        { id: "p1", first_name: "Ada", last_name: "L", preferred_name: null, avatar_url: "a.jpg" },
        { id: "p2", first_name: "Bo", last_name: "M", preferred_name: null, avatar_url: null },
      ],
    });
    const { members } = await loadFundFormData(client, ORG);
    expect(calls[0].table).toBe("profiles_directory");
    expect(calls[0].filters).toEqual([["eq", "org_id", ORG]]);
    expect(members.map((m) => [m.id, m.avatarUrl])).toEqual([
      ["p1", "signed:a.jpg"],
      ["p2", null],
    ]);
  });
});

function steward(id: string, avatarUrl: string | null) {
  return {
    id,
    first_name: id,
    last_name: null,
    preferred_name: null,
    avatar_url: avatarUrl,
  };
}

describe("signStewardAvatars", () => {
  it("signs each fund's steward and co_steward avatars into the right slots", async () => {
    const funds = [
      { id: "f1", steward: steward("s1", "url-s1"), co_steward: steward("c1", "url-c1") },
      { id: "f2", steward: steward("s2", "url-s2"), co_steward: null },
    ];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward?.avatar_url).toBe("signed:url-s1");
    expect(result[0].co_steward?.avatar_url).toBe("signed:url-c1");
    expect(result[1].steward?.avatar_url).toBe("signed:url-s2");
    expect(result[1].co_steward).toBeNull();
  });

  it("does not cross-contaminate slots across multiple funds", async () => {
    const funds = [
      { id: "f1", steward: steward("s1", "url-f1-steward"), co_steward: steward("c1", "url-f1-co") },
      { id: "f2", steward: steward("s2", "url-f2-steward"), co_steward: steward("c2", "url-f2-co") },
      { id: "f3", steward: steward("s3", "url-f3-steward"), co_steward: null },
    ];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward?.avatar_url).toBe("signed:url-f1-steward");
    expect(result[0].co_steward?.avatar_url).toBe("signed:url-f1-co");
    expect(result[1].steward?.avatar_url).toBe("signed:url-f2-steward");
    expect(result[1].co_steward?.avatar_url).toBe("signed:url-f2-co");
    expect(result[2].steward?.avatar_url).toBe("signed:url-f3-steward");
    expect(result[2].co_steward).toBeNull();
  });

  it("leaves steward/co_steward null when the fund has none", async () => {
    const funds = [{ id: "f1", steward: null, co_steward: null }];

    const result = await signStewardAvatars(funds);

    expect(result[0].steward).toBeNull();
    expect(result[0].co_steward).toBeNull();
  });

  it("returns an empty array for no funds without minting anything", async () => {
    expect(await signStewardAvatars([])).toEqual([]);
  });
});
