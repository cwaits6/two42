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
      { id: "ada", org_id: ORG, first_name: "Ada", email: "ada_o@example.test", family_id: "f1" },
      { id: "ben", org_id: ORG, first_name: "Ben", email: "ben@example.test", family_id: "f1" },
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
      { org_id: ORG, user_id: "ada", status: "yes", occurrence_date: "2026-11-08", created_at: "t", events: { title: "Picnic", start_time: "s" } },
      { org_id: ORG, user_id: "ada", status: "maybe", occurrence_date: "2026-11-15", created_at: "t", events: { title: "Picnic", start_time: "s" } },
      { org_id: ORG, user_id: "ben", status: "no", created_at: "t", events: { title: "Bens event", start_time: "s" } },
    ],
    serving_signup_attendees: [
      { org_id: ORG, profile_id: "ada", serving_signups: { service_date: "2026-11-01", teams: { name: "Set-up" } } },
      { org_id: ORG, profile_id: "ben", serving_signups: { service_date: "2026-12-01", teams: { name: "Set-up" } } },
    ],
    giving_funds: [
      { org_id: ORG, steward_id: "ada", name: "Mission trip", description: "Summer", is_active: true, retire_on: null, groups: { name: "Grace" }, giving_fund_methods: [{ method: "venmo", custom_handle: "@ada" }] },
      { org_id: ORG, steward_id: "ben", co_steward_id: "ada", name: "Bens fund", groups: { name: "Grace" }, giving_fund_methods: [{ method: "venmo", custom_handle: "@bens-handle" }] },
      { org_id: OTHER_ORG, steward_id: "ada", name: "Far fund", groups: { name: "Far" }, giving_fund_methods: [] },
    ],
    feedback: [
      { org_id: ORG, profile_id: "ada", type: "idea", message: "Her idea", created_at: "t" },
      { org_id: ORG, profile_id: "ben", type: "idea", message: "Someone elses idea", created_at: "t" },
      { org_id: OTHER_ORG, profile_id: "ada", type: "idea", message: "Far idea", created_at: "t" },
    ],
    group_requests: [
      { org_id: ORG, requested_by: "ada", name: "Young couples", description: "Her pitch", status: "pending", created_at: "t" },
      { org_id: ORG, requested_by: "ben", name: "Bens group", description: "His pitch", status: "pending", created_at: "t" },
      { org_id: OTHER_ORG, requested_by: "ada", name: "Far group", description: "Far pitch", status: "pending", created_at: "t" },
    ],
    access_requests: [
      { org_id: ORG, email: "ADA_O@example.test", message: "Her note", status: "approved", created_at: "t" },
      { org_id: ORG, email: "ada_o@example.test", message: null, status: "approved", created_at: "t" },
      { org_id: ORG, email: "adaxo@example.test", message: "Lookalike note", status: "approved", created_at: "t" },
      { org_id: ORG, email: "ben@example.test", message: "Bens note", status: "approved", created_at: "t" },
      { org_id: OTHER_ORG, email: "ada_o@example.test", message: "Far note", status: "approved", created_at: "t" },
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
    expect(data?.rsvps.map((r) => [r.event, r.date, r.status])).toEqual([
      ["Picnic", "2026-11-08", "yes"],
      ["Picnic", "2026-11-15", "maybe"],
    ]);
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

  it("includes the funds they receive, with their payment methods, and no one else's", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.funds_you_receive).toEqual([
      {
        fund: "Mission trip",
        group: "Grace",
        description: "Summer",
        active: true,
        retire_on: null,
        payment_methods: [{ method: "venmo", handle: "@ada" }],
      },
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toContain("@bens-handle");
    expect(text).not.toContain("Far fund");
  });

  it("includes their own feedback and no one else's", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.feedback).toEqual([{ type: "idea", message: "Her idea", sent_at: "t" }]);
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

  it("leaves a new household entry column out until it's listed", async () => {
    const { tables } = setup();
    tables.family_members[2].some_internal_flag = true;
    const data = await buildAccountExport(ORG, "ada");
    expect(JSON.stringify(data?.household_entries)).not.toContain("some_internal_flag");
  });

  it("carries a null birth year as a null, for a child whose year was cleared", async () => {
    const { tables } = setup();
    tables.family_members[2].birth_year = null;
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.household_entries[1]).toEqual({ first_name: "Kid", birth_year: null });
  });

  it("includes the group requests they wrote, in this church only", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.group_requests).toEqual([
      { name: "Young couples", description: "Her pitch", status: "pending", requested_at: "t" },
    ]);
  });

  it("includes the message on their access request, matched exactly on their address", async () => {
    setup();
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.access_requests).toEqual([{ message: "Her note", status: "approved", sent_at: "t" }]);
  });

  it("has no access requests when their profile has no address", async () => {
    const { tables } = setup();
    tables.profiles[0].email = null;
    const data = await buildAccountExport(ORG, "ada");
    expect(data?.access_requests).toEqual([]);
  });

  it("is null for someone with no profile in this church", async () => {
    setup();
    expect(await buildAccountExport(OTHER_ORG, "ada")).toBeNull();
  });

  it.each(["group_members", "team_members", "rsvps", "serving_signup_attendees", "prayer_requests", "giving_funds", "feedback", "family_units", "family_members", "group_requests", "access_requests"])(
    "throws rather than build a partial file when %s can't be read",
    async (table) => {
      const { failures } = setup();
      failures.push({ table, op: "select" });
      await expect(buildAccountExport(ORG, "ada")).rejects.toThrow();
    },
  );
});
