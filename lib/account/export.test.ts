import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeService, type Tables } from "./fakeServiceTestHelpers";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { buildAccountExport } = await import("./export");

const ORG = "org-1";
const OTHER_ORG = "org-2";

function setup() {
  const tables: Tables = {
    profiles: [
      { id: "ada", org_id: ORG, first_name: "Ada", family_id: "f1" },
      { id: "ben", org_id: ORG, first_name: "Ben", family_id: "f1" },
    ],
    family_units: [{ id: "f1", org_id: ORG, family_name: "Okafor" }],
    family_members: [
      { id: "m1", org_id: ORG, family_id: "f1", first_name: "Ada", claimed_profile_id: "ada", avatar_url: "x" },
      { id: "m2", org_id: ORG, family_id: "f1", first_name: "Ben", claimed_profile_id: "ben" },
      { id: "m3", org_id: ORG, family_id: "f1", first_name: "Kid", claimed_profile_id: null },
    ],
    group_members: [
      { org_id: ORG, profile_id: "ada", role: "leader", joined_at: "t", groups: { name: "Grace" } },
      { org_id: ORG, profile_id: "ben", role: "member", joined_at: "t", groups: { name: "Bens" } },
    ],
    team_members: [
      { org_id: ORG, profile_id: "ada", is_leader: false, assigned_at: "t", teams: { name: "Set-up" } },
    ],
    rsvps: [
      { org_id: ORG, user_id: "ada", status: "yes", created_at: "t", events: { title: "Picnic", start_time: "s" } },
      { org_id: ORG, user_id: "ben", status: "no", created_at: "t", events: { title: "Bens event", start_time: "s" } },
    ],
    serving_signup_attendees: [
      { org_id: ORG, profile_id: "ada", serving_signups: { service_date: "2026-11-01", teams: { name: "Set-up" } } },
      { org_id: ORG, profile_id: "ben", serving_signups: { service_date: "2026-12-01", teams: { name: "Set-up" } } },
    ],
    prayer_requests: [
      { org_id: ORG, author_id: "ada", body: "By name", is_anonymous: false, is_answered: false, created_at: "t", groups: { name: "Grace" } },
      { org_id: ORG, author_id: "ada", body: "Quietly", is_anonymous: true, is_answered: true, created_at: "t", groups: { name: "Grace" } },
      { org_id: ORG, author_id: "ben", body: "Bens request", is_anonymous: true, is_answered: false, created_at: "t", groups: { name: "Grace" } },
      { org_id: OTHER_ORG, author_id: "ada", body: "Other church", is_anonymous: false, is_answered: false, created_at: "t", groups: { name: "Far" } },
    ],
  };
  const fake = fakeService(tables);
  createServiceClient.mockResolvedValue(fake.client);
  return { tables, ...fake };
}

beforeEach(() => {
  createServiceClient.mockReset();
});

describe("buildAccountExport", () => {
  it("holds this person's own rows and nobody else's", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    const text = JSON.stringify(data);
    expect(data?.profile.first_name).toBe("Ada");
    expect(data?.groups).toEqual([{ group: "Grace", role: "leader", joined_at: "t" }]);
    expect(data?.rsvps.map((r) => r.event)).toEqual(["Picnic"]);
    expect(data?.serving_turns).toEqual([{ team: "Set-up", date: "2026-11-01" }]);
    for (const other of ["Ben", "Bens", "2026-12-01", "Other church"]) {
      expect(text).not.toContain(other);
    }
  });

  it("includes their anonymous prayer requests", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.prayer_requests.map((p) => [p.body, p.anonymous])).toEqual([
      ["By name", false],
      ["Quietly", true],
    ]);
  });

  it("lists household entries except ones claimed by someone else, with no internal ids", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.household_entries).toEqual([{ first_name: "Ada" }, { first_name: "Kid" }]);
    expect(data?.household).toMatchObject({ family_name: "Okafor" });
  });

  it("carries a household entry's birth year only when the column is there", async () => {
    const { tables } = setup();
    tables.family_members[2].birth_year = 2015;
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.household_entries[1]).toEqual({ first_name: "Kid", birth_year: 2015 });
  });

  it("is null for someone with no profile in this church", async () => {
    setup();
    expect(await buildAccountExport(OTHER_ORG, "ada")).toBeNull();
  });

  it.each(["group_members", "team_members", "rsvps", "serving_signup_attendees", "prayer_requests", "family_units", "family_members"])(
    "throws rather than build a partial file when %s can't be read",
    async (table) => {
      const { failures } = setup();
      failures.push({ table, op: "select" });
      await expect(buildAccountExport(ORG, "ada")).rejects.toThrow();
    },
  );
});
