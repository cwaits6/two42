import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

type Read = { data: unknown[] | null; error: { code: string; message: string } | null };
let reads: Record<string, Read>;
let settings: Promise<unknown>;

function query(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => Promise.resolve({ data: { role: "member", org_id: "o1", first_name: "Ada" }, error: null }),
    then: (resolve: (r: Read) => unknown) => Promise.resolve(resolve(reads[table])),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected");
  },
  useRouter: () => ({ refresh: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: "member" }),
}));
vi.mock("@/lib/groups/settings", () => ({ getGroupSettings: () => settings }));
vi.mock("@/lib/giving/server", () => ({ loadFundFormData: async () => ({ members: [] }) }));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrl: async () => null,
  mintSignedUrls: async (urls: unknown[]) => urls.map(() => null),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/pageTitle", () => ({ groupPageTitle: () => async () => ({}) }));

const { default: PrayerPage } = await import("./page");

async function render() {
  const element = (await PrayerPage({ params: Promise.resolve({ groupId: "g1" }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

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
  settings = Promise.resolve({ weekly_prayer_call_url: null, weekly_prayer_call_time: "Tuesdays at 7am" });
  reads = {
    prayer_wall: { data: [goodRow], error: null },
    prayer_call_sessions: { data: [], error: null },
  };
});

describe("PrayerPage", () => {
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
    reads.prayer_call_sessions.data = [{ id: "s1", weekday: 12, start_time: null, end_time: "late" }];
    const html = await render();
    expect(html).toContain("Pray for a steady week.");
    expect(html).toContain("2 shown");
    expect(html).toContain("The prayer call");
  });

  it("shows the error state, not a crash, when the requests can't be read", async () => {
    reads.prayer_wall = { data: null, error: { code: "57014", message: "canceling statement" } };
    const html = await render();
    expect(html).toContain("Couldn&#x27;t load prayer requests.");
    expect(html).not.toContain("Share a request");
  });

  it("keeps the wall and reports the call when the call times can't be read", async () => {
    reads.prayer_call_sessions = { data: null, error: { code: "57014", message: "canceling statement" } };
    const html = await render();
    expect(html).toContain("Pray for a steady week.");
    expect(html).toContain("Couldn&#x27;t load the prayer call.");
  });

  it("reports the call when the group settings can't be read", async () => {
    settings = Promise.reject(new Error("boom"));
    const html = await render();
    expect(html).toContain("Pray for a steady week.");
    expect(html).toContain("Couldn&#x27;t load the prayer call.");
  });
});
