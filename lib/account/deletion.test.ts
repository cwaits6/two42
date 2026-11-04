import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeService, type Tables } from "./fakeServiceTestHelpers";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));
const notifyLeadersOfCancel = vi.fn();
vi.mock("@/lib/serving/server", () => ({
  notifyLeadersOfCancel: (...args: unknown[]) => notifyLeadersOfCancel(...args),
}));
const afterResponse: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => afterResponse.push(task),
}));
const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

const { deletePerson, deletionResponse, loadDeletionSummary } = await import("./deletion");

const ORG = "org-1";
const OTHER_ORG = "org-2";

function person(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    org_id: ORG,
    role: "member",
    family_id: null,
    first_name: id,
    last_name: "Test",
    preferred_name: null,
    ...extra,
  };
}

const DELETED = {
  first_name: "Ada",
  last_name: "Okafor",
  preferred_name: null,
  email: "ada@example.test",
  photo_keys: [],
  opened_dates: [],
};

function setup(overrides: Partial<Tables> = {}) {
  const tables: Tables = {
    profiles: [person("ada"), person("ben"), person("outsider", { org_id: OTHER_ORG })],
    platform_admins: [],
    family_members: [],
    family_units: [],
    giving_funds: [],
    group_members: [],
    ...overrides,
  } as Tables;
  const fake = fakeService(tables);
  fake.state.rpcResult = DELETED;
  createServiceClient.mockResolvedValue(fake.client);
  return { tables, ...fake };
}

beforeEach(() => {
  createServiceClient.mockReset();
  notifyLeadersOfCancel.mockReset();
  afterResponse.length = 0;
  consoleError.mockClear();
});

describe("deletePerson", () => {
  it("hands the person and the caller's org to the one transaction", async () => {
    const { log } = setup();
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 0 });
    expect(log.rpcs).toEqual([{ name: "delete_person", args: { _person_id: "ada", _org_id: ORG } }]);
  });

  it.each([
    ["AD001", "not_found"],
    ["AD002", "platform_operator"],
    ["CA001", "last_church_admin"],
    ["XX000", "failed"],
  ])("maps %s to %s, and acts on nothing after it", async (code, outcome) => {
    const { log, state } = setup();
    state.rpcError = { code };
    state.rpcResult = { ...DELETED, photo_keys: ["k"], opened_dates: [{}] };
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome });
    expect(log.removedObjects).toEqual([]);
    expect(notifyLeadersOfCancel).not.toHaveBeenCalled();
    expect(afterResponse).toEqual([]);
  });

  it("reports failure when the service client can't be built", async () => {
    createServiceClient.mockRejectedValue(new Error("no key"));
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "failed" });
  });
});

describe("deletePerson: photos, after the transaction", () => {
  const keys = [`${ORG}/profiles/ada/avatar.jpg`, "ada/avatar.jpg"];

  it("removes what the function found, on both key layouts", async () => {
    const { log, state } = setup();
    state.rpcResult = { ...DELETED, photo_keys: keys };
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 0 });
    expect(log.removedObjects).toEqual(keys.map((k) => `avatars/${k}`));
  });

  it("is still deleted when storage fails, and says how many photos remain", async () => {
    const { state } = setup();
    state.rpcResult = { ...DELETED, photo_keys: keys };
    state.storageError = { message: "down" };
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 2 });
  });

  it("counts a key storage reports nothing for", async () => {
    const { state } = setup();
    state.rpcResult = { ...DELETED, photo_keys: keys };
    state.storageSkips = ["ada/avatar.jpg"];
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 1 });
  });
});

describe("deletePerson: team leads, after the response", () => {
  const date = { team_id: "t1", group_id: "g1", team_name: "Set-up", service_date: "2090-01-08" };
  const runAfterResponse = () => Promise.all(afterResponse.map((task) => task()));

  it("has told nobody by the time it answers", async () => {
    const { state } = setup();
    state.rpcResult = { ...DELETED, opened_dates: [date] };
    expect(await deletePerson(ORG, "ada", "admin")).toEqual({ outcome: "deleted", photosNotRemoved: 0 });
    expect(notifyLeadersOfCancel).not.toHaveBeenCalled();
    expect(afterResponse).toHaveLength(1);
  });

  it("sends each team's dates together, naming who left", async () => {
    const { state } = setup();
    state.rpcResult = {
      ...DELETED,
      opened_dates: [
        date,
        { team_id: "t2", group_id: "g1", team_name: "Coffee", service_date: "2090-01-08" },
        { ...date, service_date: "2090-01-15" },
      ],
    };
    await deletePerson(ORG, "ada", "admin");
    await runAfterResponse();
    expect(notifyLeadersOfCancel).toHaveBeenCalledTimes(2);
    expect(notifyLeadersOfCancel.mock.calls[0][1]).toEqual({
      groupId: "g1",
      teamId: "t1",
      orgId: ORG,
      teamName: "Set-up",
      serviceDates: ["2090-01-08", "2090-01-15"],
      memberLabel: "Ada Okafor",
      excludeProfileId: "admin",
    });
    expect(notifyLeadersOfCancel.mock.calls[1][1]).toMatchObject({
      teamId: "t2",
      serviceDates: ["2090-01-08"],
    });
  });

  it("names someone with no name by their email", async () => {
    const { state } = setup();
    state.rpcResult = { ...DELETED, first_name: null, last_name: null, opened_dates: [date] };
    await deletePerson(ORG, "ada");
    await runAfterResponse();
    expect(notifyLeadersOfCancel.mock.calls[0][1].memberLabel).toBe("ada@example.test");
  });

  it("logs a failed team without its message, and tries the next team", async () => {
    const { state } = setup();
    state.rpcResult = {
      ...DELETED,
      opened_dates: [date, { ...date, team_id: "t2" }],
    };
    notifyLeadersOfCancel.mockRejectedValueOnce(new Error("Ada Okafor <ada@example.test> bounced"));
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 0 });
    await runAfterResponse();
    expect(notifyLeadersOfCancel).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls.flat().map(String).join(" ")).not.toMatch(/Ada|example\.test/);
  });
});

describe("loadDeletionSummary", () => {
  const funds = [
    { name: "Passes on", org_id: ORG, steward_id: "ada", co_steward_id: "ben", group_id: "g1", groups: { name: "Grace" } },
    { name: "No second", org_id: ORG, steward_id: "ada", co_steward_id: null, group_id: "g1", groups: { name: "Grace" } },
    { name: "Second left", org_id: ORG, steward_id: "ada", co_steward_id: "cam", group_id: "g1", groups: { name: "Grace" } },
    { name: "Bens", org_id: ORG, steward_id: "ben", co_steward_id: "ada", group_id: "g1", groups: { name: "Grace" } },
    { name: "Elsewhere", org_id: OTHER_ORG, steward_id: "ada", co_steward_id: null, group_id: "g9", groups: { name: "Far" } },
  ];
  const memberships = [
    { org_id: ORG, group_id: "g1", profile_id: "ben", role: "member" },
    { org_id: ORG, group_id: "g2", profile_id: "cam", role: "member" },
  ];

  it("is null for someone in another church", async () => {
    setup();
    expect(await loadDeletionSummary(ORG, "outsider", "church_admin")).toBeNull();
  });

  it("names someone with no name by their email", async () => {
    setup({ profiles: [person("ada", { first_name: null, last_name: null, email: "ada@example.test" })] });
    const summary = await loadDeletionSummary(ORG, "ada", "church_admin");
    expect(summary?.name).toBe("ada@example.test");
  });

  it("names a second person with no name by their email", async () => {
    setup({
      giving_funds: funds,
      group_members: memberships,
      profiles: [person("ada"), person("ben", { first_name: null, last_name: null, email: "ben@example.test" })],
    });
    const summary = await loadDeletionSummary(ORG, "ada", "self");
    expect(summary?.groupContent).toMatchObject({
      fundsPassedOn: [{ name: "Passes on", recipient: "ben@example.test" }],
    });
  });

  it("doesn't pass a fund on to a pending second person, as the database won't", async () => {
    setup({
      giving_funds: funds,
      group_members: memberships,
      profiles: [person("ada"), person("ben", { role: "pending" }), person("cam")],
    });
    const summary = await loadDeletionSummary(ORG, "ada", "self");
    expect(summary?.groupContent).toMatchObject({
      fundsPassedOn: [],
      fundsNeedingRecipient: [{ name: "Passes on" }, { name: "No second" }, { name: "Second left" }],
    });
  });

  it("names each fund's fate for the person, in this church only", async () => {
    setup({ giving_funds: funds, group_members: memberships, profiles: [person("ada"), person("ben"), person("cam")] });
    const summary = await loadDeletionSummary(ORG, "ada", "self");
    expect(summary?.groupContent).toMatchObject({
      kind: "names",
      fundsPassedOn: [{ name: "Passes on", group: "Grace", recipient: "ben Test" }],
      fundsNeedingRecipient: [
        { name: "No second", group: "Grace" },
        { name: "Second left", group: "Grace" },
      ],
    });
  });

  it("gives a church admin counts, with no fund or group name anywhere in the answer", async () => {
    setup({
      giving_funds: funds,
      group_members: [
        ...memberships,
        { org_id: ORG, group_id: "g3", profile_id: "ada", role: "leader", groups: { name: "Alone" } },
      ],
      profiles: [person("ada"), person("ben"), person("cam")],
    });
    const summary = await loadDeletionSummary(ORG, "ada", "church_admin");
    expect(summary?.groupContent).toEqual({
      kind: "counts",
      fundsPassedOn: 1,
      fundsNeedingRecipient: 2,
      groupsLosingLeader: 1,
    });
    const text = JSON.stringify(summary);
    for (const name of ["Passes on", "No second", "Grace", "Alone", "ben Test"]) {
      expect(text).not.toContain(name);
    }
  });

  it("names the groups they alone lead, for the person", async () => {
    setup({
      group_members: [
        { org_id: ORG, group_id: "g1", profile_id: "ada", role: "leader", groups: { name: "Alone" } },
        { org_id: ORG, group_id: "g2", profile_id: "ada", role: "leader", groups: { name: "Shared" } },
        { org_id: ORG, group_id: "g2", profile_id: "ben", role: "leader", groups: { name: "Shared" } },
        { org_id: ORG, group_id: "g3", profile_id: "ada", role: "member", groups: { name: "Member" } },
      ],
    });
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.groupContent).toMatchObject({
      groupsLosingLeader: ["Alone"],
    });
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
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.household).toEqual({
      name: "Okafor",
      shared: false,
      entries: ["Kid O"],
    });

    setup({
      profiles: [person("ada", { family_id: "f1" }), person("ben", { family_id: "f1" })],
      family_units: units,
      family_members: entries,
    });
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.household?.shared).toBe(true);
  });

  it("flags the last church admin", async () => {
    setup({ profiles: [person("ada", { role: "admin" })] });
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.lastChurchAdmin).toBe(true);
  });

  it("flags a platform operator", async () => {
    setup({ platform_admins: [{ profile_id: "ada" }] });
    expect((await loadDeletionSummary(ORG, "ada", "church_admin"))?.platformOperator).toBe(true);
    expect((await loadDeletionSummary(ORG, "ben", "church_admin"))?.platformOperator).toBe(false);
  });

  it("throws rather than answer from a failed read", async () => {
    const { failures } = setup();
    failures.push({ table: "platform_admins", op: "select" });
    await expect(loadDeletionSummary(ORG, "ada", "self")).rejects.toThrow();
  });
});

describe("deletionResponse", () => {
  it.each([
    [{ outcome: "deleted", photosNotRemoved: 0 }, 200],
    [{ outcome: "not_found" }, 404],
    [{ outcome: "last_church_admin" }, 409],
    [{ outcome: "platform_operator" }, 409],
    [{ outcome: "failed" }, 500],
  ] as const)("answers %j with %i", (result, status) => {
    expect(deletionResponse(result).status).toBe(status);
  });

  it("says how many photos are still stored", async () => {
    const res = deletionResponse({ outcome: "deleted", photosNotRemoved: 2 });
    expect(await res.json()).toEqual({ ok: true, photosNotRemoved: 2 });
  });

  it("says which refusal a 409 is", async () => {
    expect(await deletionResponse({ outcome: "platform_operator" }).json()).toEqual({ error: "platform_operator" });
  });
});
