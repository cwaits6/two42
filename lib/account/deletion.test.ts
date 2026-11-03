import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeService, type Tables } from "./fakeServiceTestHelpers";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

const { deletePerson, deletionResponse, loadDeletionSummary } = await import("./deletion");

const ORG = "org-1";
const OTHER_ORG = "org-2";

function person(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    org_id: ORG,
    role: "member",
    email: `${id}@example.test`,
    family_id: null,
    first_name: id,
    last_name: "Test",
    preferred_name: null,
    ...extra,
  };
}

function setup(overrides: Partial<Tables> = {}) {
  const tables: Tables = {
    profiles: [person("ada"), person("ben"), person("outsider", { org_id: OTHER_ORG })],
    serving_signups: [],
    serving_signup_attendees: [],
    access_requests: [],
    group_invite_uses: [],
    family_invites: [],
    family_members: [],
    family_units: [],
    giving_funds: [],
    group_members: [],
    ...overrides,
  } as Tables;
  const fake = fakeService(tables);
  createServiceClient.mockResolvedValue(fake.client);
  return { tables, ...fake };
}

beforeEach(() => {
  createServiceClient.mockReset();
});

describe("deletePerson: who it can reach", () => {
  it("treats someone in another church as not found and writes nothing", async () => {
    const { log, tables } = setup();
    expect(await deletePerson(ORG, "outsider")).toBe("not_found");
    expect(log.deletedUsers).toEqual([]);
    expect(log.writes).toEqual([]);
    expect(log.removedObjects).toEqual([]);
    expect(tables.profiles).toHaveLength(3);
  });

  it("deletes the login of the person named, in their own church", async () => {
    const { log, tables } = setup();
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(log.deletedUsers).toEqual(["ada"]);
    expect(tables.profiles.map((p) => p.id)).toEqual(["ben", "outsider"]);
  });

  it("scopes every write to the org", async () => {
    const { log } = setup({
      access_requests: [{ id: "r1", org_id: ORG, email: "ada@example.test" }],
      serving_signups: [{ id: "s1", org_id: ORG, created_by: "ada" }],
      serving_signup_attendees: [
        { signup_id: "s1", org_id: ORG, profile_id: "ada" },
        { signup_id: "s1", org_id: ORG, profile_id: "ben" },
      ],
    });
    await deletePerson(ORG, "ada");
    expect(log.writes.length).toBeGreaterThan(0);
    for (const write of log.writes) expect(write.filters).toContain("org_id");
  });
});

describe("deletePerson: the last church admin", () => {
  const admin = person("ada", { role: "admin" });

  it("refuses before any write when they are the last", async () => {
    const { log } = setup({ profiles: [admin, person("ben")] });
    expect(await deletePerson(ORG, "ada")).toBe("last_church_admin");
    expect(log.writes).toEqual([]);
    expect(log.removedObjects).toEqual([]);
    expect(log.deletedUsers).toEqual([]);
  });

  it("doesn't count a church admin of another church", async () => {
    const { log } = setup({
      profiles: [admin, person("outsider", { org_id: OTHER_ORG, role: "admin" })],
    });
    expect(await deletePerson(ORG, "ada")).toBe("last_church_admin");
    expect(log.deletedUsers).toEqual([]);
  });

  it("lets an admin go while another stays", async () => {
    const { log } = setup({ profiles: [admin, person("ben", { role: "admin" })] });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(log.deletedUsers).toEqual(["ada"]);
  });

  it("reports the refusal when the database rule decides after a race", async () => {
    const { state, tables } = setup({ profiles: [admin, person("ben", { role: "admin" })] });
    const realLast = tables.profiles[1];
    state.deleteUserError = { code: "unexpected_failure" };
    // The other admin is demoted between the check and the delete.
    state.onDeleteUser = () => {
      realLast.role = "member";
    };
    expect(await deletePerson(ORG, "ada")).toBe("last_church_admin");
  });
});

describe("deletePerson: serving dates", () => {
  const attendees = (signup: string, ...people: string[]) =>
    people.map((profile_id) => ({ signup_id: signup, org_id: ORG, profile_id }));

  it("moves a date this person booked to whoever serves it with them", async () => {
    const { tables } = setup({
      serving_signups: [{ id: "s1", org_id: ORG, created_by: "ada" }],
      serving_signup_attendees: attendees("s1", "ada", "ben"),
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.serving_signups).toEqual([{ id: "s1", org_id: ORG, created_by: "ben" }]);
  });

  it("leaves a date they booked for themself alone to the cascade", async () => {
    const { tables, log } = setup({
      serving_signups: [{ id: "s1", org_id: ORG, created_by: "ada" }],
      serving_signup_attendees: attendees("s1", "ada"),
    });
    await deletePerson(ORG, "ada");
    expect(tables.serving_signups[0].created_by).toBe("ada");
    expect(log.writes.filter((w) => w.table === "serving_signups")).toEqual([]);
  });

  it("opens a date someone else booked for this person alone", async () => {
    const { tables } = setup({
      serving_signups: [{ id: "s1", org_id: ORG, created_by: "ben" }],
      serving_signup_attendees: attendees("s1", "ada"),
    });
    await deletePerson(ORG, "ada");
    expect(tables.serving_signups).toEqual([]);
  });

  it("keeps a date someone else booked when others are still on it", async () => {
    const { tables } = setup({
      serving_signups: [{ id: "s1", org_id: ORG, created_by: "ben" }],
      serving_signup_attendees: attendees("s1", "ada", "ben"),
    });
    await deletePerson(ORG, "ada");
    expect(tables.serving_signups).toEqual([{ id: "s1", org_id: ORG, created_by: "ben" }]);
  });
});

describe("deletePerson: household", () => {
  const unit = { id: "f1", org_id: ORG, family_name: "Okafor" };
  const inFamily = { family_id: "f1" };

  it("keeps a shared household and everyone else's details, removing only their own entry", async () => {
    const { tables, log } = setup({
      profiles: [person("ada", inFamily), person("ben", inFamily)],
      family_units: [unit],
      family_members: [
        { id: "m-ada", org_id: ORG, family_id: "f1", first_name: "Ada", claimed_profile_id: "ada" },
        { id: "m-ben", org_id: ORG, family_id: "f1", first_name: "Ben", claimed_profile_id: "ben" },
        { id: "m-kid", org_id: ORG, family_id: "f1", first_name: "Kid", claimed_profile_id: null },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.family_units).toEqual([unit]);
    expect(tables.family_members.map((m) => m.id)).toEqual(["m-ben", "m-kid"]);
    expect(log.removedObjects).not.toContain(`avatars/${ORG}/families/f1/photo.jpg`);
    expect(log.removedObjects).not.toContain(`avatars/${ORG}/family-members/m-kid/avatar.jpg`);
  });

  it("removes a household with no one else left, with its entries' photos", async () => {
    const { tables, log } = setup({
      profiles: [person("ada", inFamily)],
      family_units: [unit],
      family_members: [
        { id: "m-kid", org_id: ORG, family_id: "f1", first_name: "Kid", claimed_profile_id: null },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.family_units).toEqual([]);
    expect(log.removedObjects).toEqual([
      `avatars/${ORG}/family-members/m-kid/avatar.jpg`,
      `avatars/${ORG}/families/f1/photo.jpg`,
      `avatars/${ORG}/profiles/ada/avatar.jpg`,
    ]);
  });
});

describe("deletePerson: sign-up records", () => {
  it("removes an approved request so the email can't sign straight back in, matching any case", async () => {
    const { tables } = setup({
      profiles: [person("ada", { email: "a_da@example.test" })],
      access_requests: [
        { id: "r1", org_id: ORG, email: "A_Da@Example.test" },
        { id: "r2", org_id: ORG, email: "aXda@example.test" },
        { id: "r3", org_id: OTHER_ORG, email: "a_da@example.test" },
      ],
      group_invite_uses: [
        { id: "u1", org_id: ORG, profile_id: "ada", email: "a_da@example.test" },
        { id: "u2", org_id: ORG, profile_id: null, email: "a_da@example.test" },
        { id: "u3", org_id: ORG, profile_id: "ben", email: "ben@example.test" },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.access_requests.map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(tables.group_invite_uses.map((u) => u.id)).toEqual(["u3"]);
  });
});

describe("deletePerson: sign-up records at other addresses", () => {
  it("removes only exact matches when the email holds a character PostgREST reads as a wildcard", async () => {
    const { tables } = setup({
      profiles: [person("ada", { email: "a*b@example.test" })],
      access_requests: [
        { id: "own", org_id: ORG, email: "A*B@example.test" },
        { id: "other", org_id: ORG, email: "axxb@example.test" },
      ],
      group_invite_uses: [
        { id: "own-use", org_id: ORG, profile_id: null, email: "a*b@example.test" },
        { id: "other-use", org_id: ORG, profile_id: null, email: "axxb@example.test" },
      ],
      family_invites: [
        { id: "own-invite", org_id: ORG, invite_email: "a*b@example.test", accepted_at: null },
        { id: "other-invite", org_id: ORG, invite_email: "axxb@example.test", accepted_at: null },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.access_requests.map((r) => r.id)).toEqual(["other"]);
    expect(tables.group_invite_uses.map((u) => u.id)).toEqual(["other-use"]);
    expect(tables.family_invites.map((i) => i.id)).toEqual(["other-invite"]);
  });

  it("matches the sign-in address when it differs from the profile's", async () => {
    const { state, tables } = setup({
      access_requests: [
        { id: "at-profile", org_id: ORG, email: "ada@example.test" },
        { id: "at-login", org_id: ORG, email: "ada.login@example.test" },
      ],
    });
    state.authEmail = "ada.login@example.test";
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.access_requests).toEqual([]);
  });

  it("finds an old address through the group invite they came in by", async () => {
    const { tables } = setup({
      access_requests: [
        { id: "linked", org_id: ORG, email: "old@example.test" },
        { id: "same-address", org_id: ORG, email: "OLD@example.test" },
        { id: "someone-else", org_id: ORG, email: "ben@example.test" },
      ],
      group_invite_uses: [
        { id: "u1", org_id: ORG, profile_id: "ada", email: "old@example.test", access_request_id: "linked" },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.access_requests.map((r) => r.id)).toEqual(["someone-else"]);
    expect(tables.group_invite_uses).toEqual([]);
  });

  it("finds an old address through the household invite they accepted", async () => {
    const { tables } = setup({
      family_members: [
        { id: "m1", org_id: ORG, family_id: "f1", first_name: "Ada", claimed_profile_id: "ada" },
      ],
      family_invites: [
        { id: "i1", org_id: ORG, family_member_id: "m1", invite_email: "old@example.test", accepted_at: "2026-01-01" },
      ],
      access_requests: [{ id: "r1", org_id: ORG, email: "old@example.test" }],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.access_requests).toEqual([]);
  });

  it("leaves what belongs to someone else at an old address they shared", async () => {
    const { tables } = setup({
      family_members: [
        { id: "m1", org_id: ORG, family_id: "f1", first_name: "Ada", claimed_profile_id: "ada" },
        { id: "m2", org_id: ORG, family_id: "f1", first_name: "Ben", claimed_profile_id: null },
      ],
      family_invites: [
        { id: "accepted", org_id: ORG, family_member_id: "m1", invite_email: "family@example.test", token: "t1", accepted_at: "2026-01-01" },
        { id: "spouse", org_id: ORG, family_member_id: "m2", invite_email: "family@example.test", token: "t2", accepted_at: null },
      ],
      access_requests: [
        { id: "own-request", org_id: ORG, email: "family@example.test", invite_token: "t1" },
        { id: "unlinked-request", org_id: ORG, email: "family@example.test", invite_token: null },
        { id: "spouse-request", org_id: ORG, email: "family@example.test", invite_token: "t2" },
      ],
      group_invite_uses: [
        { id: "spouse-use", org_id: ORG, profile_id: "ben", email: "family@example.test" },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.family_invites.map((i) => i.id)).toContain("spouse");
    expect(tables.access_requests.map((r) => r.id)).toEqual(["spouse-request"]);
    expect(tables.group_invite_uses.map((u) => u.id)).toEqual(["spouse-use"]);
  });

  const oldAddressSteps = [
    { name: "the uses found by address", failure: { table: "group_invite_uses", op: "delete" } },
    { name: "the requests", failure: { table: "access_requests", op: "delete" } },
    { name: "their own uses", failure: { table: "group_invite_uses", op: "delete", skip: 1 } },
  ] as const;

  for (const { name, failure } of oldAddressSteps) {
    it(`still clears an old address on retry after deleting ${name} fails`, async () => {
      const { failures, log, tables } = setup({
        access_requests: [
          { id: "linked", org_id: ORG, email: "old@example.test" },
          { id: "same-address", org_id: ORG, email: "old@example.test" },
        ],
        group_invite_uses: [
          { id: "own", org_id: ORG, profile_id: "ada", email: "old@example.test", access_request_id: "linked" },
          { id: "at-address", org_id: ORG, profile_id: null, email: "old@example.test", access_request_id: null },
        ],
      });
      failures.push({ ...failure });
      expect(await deletePerson(ORG, "ada")).toBe("failed");
      expect(log.deletedUsers).toEqual([]);

      failures.length = 0;
      expect(await deletePerson(ORG, "ada")).toBe("deleted");
      expect(tables.access_requests).toEqual([]);
      expect(tables.group_invite_uses).toEqual([]);
    });
  }

  it("removes an unclaimed household invite to their address, and no one else's", async () => {
    const { tables } = setup({
      family_invites: [
        { id: "theirs", org_id: ORG, invite_email: "Ada@example.test", accepted_at: null },
        { id: "accepted", org_id: ORG, invite_email: "ada@example.test", accepted_at: "2026-01-01" },
        { id: "other-address", org_id: ORG, invite_email: "ben@example.test", accepted_at: null },
        { id: "other-church", org_id: OTHER_ORG, invite_email: "ada@example.test", accepted_at: null },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(tables.family_invites.map((i) => i.id)).toEqual(["accepted", "other-address", "other-church"]);
  });
});

describe("deletePerson: failure at any step", () => {
  const full = () => ({
    profiles: [person("ada", { family_id: "f1" })],
    family_units: [{ id: "f1", org_id: ORG, family_name: "Okafor" }],
    family_members: [
      { id: "m1", org_id: ORG, family_id: "f1", first_name: "Ada", claimed_profile_id: "ada" },
    ],
    serving_signups: [{ id: "s1", org_id: ORG, created_by: "ada" }],
    serving_signup_attendees: [
      { signup_id: "s1", org_id: ORG, profile_id: "ada" },
      { signup_id: "s1", org_id: ORG, profile_id: "ben" },
    ],
    access_requests: [{ id: "r1", org_id: ORG, email: "ada@example.test" }],
    group_invite_uses: [{ id: "u1", org_id: ORG, profile_id: "ada", email: null, access_request_id: "r1" }],
    family_invites: [
      { id: "i1", org_id: ORG, family_member_id: "m1", invite_email: "ada.old@example.test", token: "t1", accepted_at: "2026-01-01" },
      { id: "i2", org_id: ORG, family_member_id: "m9", invite_email: "ada@example.test", accepted_at: null },
    ],
  });

  const steps = [
    { table: "serving_signups", op: "select" },
    { table: "serving_signup_attendees", op: "select" },
    { table: "serving_signups", op: "update" },
    { table: "access_requests", op: "select" },
    { table: "access_requests", op: "delete" },
    { table: "group_invite_uses", op: "select" },
    { table: "group_invite_uses", op: "delete" },
    { table: "family_invites", op: "select" },
    { table: "family_invites", op: "delete" },
    { table: "family_members", op: "select" },
    { table: "family_members", op: "delete" },
    { table: "family_units", op: "select" },
    { table: "family_units", op: "delete" },
  ] as const;

  for (const step of steps) {
    it(`keeps the login when ${step.op} on ${step.table} fails, and a retry finishes`, async () => {
      const { failures, log, tables } = setup(full());
      failures.push(step);
      expect(await deletePerson(ORG, "ada")).toBe("failed");
      expect(log.deletedUsers).toEqual([]);
      expect(tables.profiles).toHaveLength(1);

      failures.length = 0;
      expect(await deletePerson(ORG, "ada")).toBe("deleted");
      expect(log.deletedUsers).toEqual(["ada"]);
      expect(tables.family_units).toEqual([]);
      expect(tables.serving_signups[0].created_by).toBe("ben");
    });
  }

  it("touches nothing when the login can't be read, and a retry finishes", async () => {
    const { log, state } = setup(full());
    state.getUserError = { code: "bad_jwt" };
    expect(await deletePerson(ORG, "ada")).toBe("failed");
    expect(log.writes).toEqual([]);
    expect(log.removedObjects).toEqual([]);
    expect(log.deletedUsers).toEqual([]);

    state.getUserError = null;
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
  });

  it("keeps the login when a photo can't be deleted, and a retry finishes", async () => {
    const { log, state } = setup(full());
    state.storageError = { message: "storage down" };
    expect(await deletePerson(ORG, "ada")).toBe("failed");
    expect(log.deletedUsers).toEqual([]);

    state.storageError = null;
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
  });

  it("reports failure when deleting the login fails, and a retry finishes", async () => {
    const { log, state, tables } = setup(full());
    state.deleteUserError = { code: "unexpected_failure" };
    expect(await deletePerson(ORG, "ada")).toBe("failed");
    expect(tables.profiles).toHaveLength(1);

    state.deleteUserError = null;
    expect(await deletePerson(ORG, "ada")).toBe("deleted");
    expect(log.deletedUsers).toEqual(["ada"]);
  });

  it("logs the login failure when the re-check after it fails too", async () => {
    const { failures, state } = setup({
      profiles: [person("ada", { role: "admin" }), person("ben", { role: "admin" })],
    });
    state.deleteUserError = { code: "unexpected_failure" };
    state.onDeleteUser = () => failures.push({ table: "profiles", op: "select" });
    consoleError.mockClear();
    expect(await deletePerson(ORG, "ada")).toBe("failed");
    expect(consoleError).toHaveBeenCalledWith(
      "Person deletion failed:",
      "delete login: code=unexpected_failure",
    );
  });

  it("reports failure when a write matched no rows", async () => {
    const { client, log } = setup(full());
    const realFrom = client.from;
    client.from = ((table: string) => {
      const builder = realFrom(table);
      if (table !== "serving_signups") return builder;
      const update = builder.update;
      // Someone cancelled the date between the read and the move.
      builder.update = (values) => update(values).eq("id", "gone");
      return builder;
    }) as typeof client.from;
    expect(await deletePerson(ORG, "ada")).toBe("failed");
    expect(log.deletedUsers).toEqual([]);
  });

  it("reports failure when the profile is still there after the login went", async () => {
    const { state } = setup(full());
    state.cascade = false;
    expect(await deletePerson(ORG, "ada")).toBe("failed");
  });

  it("reports failure when the service client can't be built", async () => {
    createServiceClient.mockRejectedValue(new Error("no key"));
    expect(await deletePerson(ORG, "ada")).toBe("failed");
  });
});

describe("loadDeletionSummary", () => {
  it("is null for someone in another church", async () => {
    setup();
    expect(await loadDeletionSummary(ORG, "outsider")).toBeNull();
  });

  it("names the funds that go to them, in this church only", async () => {
    setup({
      giving_funds: [
        { name: "Mission trip", org_id: ORG, steward_id: "ada", groups: { name: "Grace" } },
        { name: "Other", org_id: ORG, steward_id: "ben", groups: { name: "Grace" } },
        { name: "Elsewhere", org_id: OTHER_ORG, steward_id: "ada", groups: { name: "Far" } },
      ],
    });
    const summary = await loadDeletionSummary(ORG, "ada");
    expect(summary?.funds).toEqual([{ name: "Mission trip", group: "Grace" }]);
  });

  it("names the groups they alone lead", async () => {
    setup({
      group_members: [
        { org_id: ORG, group_id: "g1", profile_id: "ada", role: "leader", groups: { name: "Alone" } },
        { org_id: ORG, group_id: "g2", profile_id: "ada", role: "leader", groups: { name: "Shared" } },
        { org_id: ORG, group_id: "g2", profile_id: "ben", role: "leader", groups: { name: "Shared" } },
        { org_id: ORG, group_id: "g3", profile_id: "ada", role: "member", groups: { name: "Member" } },
      ],
    });
    expect((await loadDeletionSummary(ORG, "ada"))?.groupsLosingLeader).toEqual(["Alone"]);
  });

  it("says whether the household stays, and who goes with it when it doesn't", async () => {
    const entries = [
      { id: "m1", org_id: ORG, family_id: "f1", first_name: "Ada", last_name: "O", preferred_name: null, claimed_profile_id: "ada" },
      { id: "m2", org_id: ORG, family_id: "f1", first_name: "Kid", last_name: "O", preferred_name: null, claimed_profile_id: null },
    ];
    const units = [{ id: "f1", org_id: ORG, family_name: "Okafor" }];

    setup({
      profiles: [person("ada", { family_id: "f1" })],
      family_units: units,
      family_members: entries,
    });
    expect((await loadDeletionSummary(ORG, "ada"))?.household).toEqual({
      name: "Okafor",
      shared: false,
      entries: ["Kid O"],
    });

    setup({
      profiles: [person("ada", { family_id: "f1" }), person("ben", { family_id: "f1" })],
      family_units: units,
      family_members: entries,
    });
    expect((await loadDeletionSummary(ORG, "ada"))?.household?.shared).toBe(true);
  });

  it("flags the last church admin", async () => {
    setup({ profiles: [person("ada", { role: "admin" })] });
    expect((await loadDeletionSummary(ORG, "ada"))?.lastChurchAdmin).toBe(true);
  });
});

describe("deletionResponse", () => {
  it.each([
    ["deleted", 200],
    ["not_found", 404],
    ["last_church_admin", 409],
    ["failed", 500],
  ] as const)("answers %s with %i", (result, status) => {
    expect(deletionResponse(result).status).toBe(status);
  });
});
