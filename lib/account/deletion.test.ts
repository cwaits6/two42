import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDeletionOutcomes } from "./deletionOutcomes";
import { authorHash, type PrayerKeys } from "@/lib/prayer/crypto";
import { testKeys } from "@/lib/prayer/testKeys";
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
const consoleError = vi.spyOn(console, "log").mockImplementation(() => {});
let keys: PrayerKeys | null;
vi.mock("@/lib/prayer/keys", () => ({ loadPrayerKeys: () => keys }));
const KEYS = testKeys();

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
    group_members: [],
    ...overrides,
  } as Tables;
  const fake = fakeService(tables);
  fake.state.rpcResult = DELETED;
  createServiceClient.mockResolvedValue(fake.client);
  return { tables, ...fake };
}

beforeEach(() => {
  keys = KEYS;
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

  it("passes the ids of their hashed anonymous requests, and no one else's", async () => {
    const hashed = (id: string, author: string, org = ORG) => ({
      id,
      org_id: org,
      is_anonymous: true,
      author_id: null,
      author_hash: authorHash(KEYS, org, id, author),
    });
    const { log } = setup({
      prayer_requests: [
        hashed("p1", "ada"),
        hashed("p2", "ben"),
        hashed("p3", "ada", OTHER_ORG),
        hashed("p4", "ada"),
        { id: "p5", org_id: ORG, is_anonymous: true, author_id: "ada", author_hash: null },
      ],
    });
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "deleted", photosNotRemoved: 0 });
    expect(log.rpcs).toEqual([
      { name: "delete_person", args: { _person_id: "ada", _org_id: ORG, _anonymous_request_ids: ["p1", "p4"] } },
    ]);
  });

  it("fails, deleting nothing, without the prayer keys or when their requests can't be read", async () => {
    keys = null;
    const { log } = setup();
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "failed" });
    expect(log.rpcs).toEqual([]);

    keys = KEYS;
    const second = setup();
    second.failures.push({ table: "prayer_requests", op: "select" });
    expect(await deletePerson(ORG, "ada")).toEqual({ outcome: "failed" });
    expect(second.log.rpcs).toEqual([]);
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

  it("never names someone to the leaders by their email", async () => {
    const { state } = setup();
    state.rpcResult = { ...DELETED, first_name: null, last_name: null, opened_dates: [date] };
    await deletePerson(ORG, "ada");
    await runAfterResponse();
    expect(notifyLeadersOfCancel.mock.calls[0][1].memberLabel).toBe("No name on file");
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
  const named = (first_name: string | null, last_name: string | null = "Test") => ({
    first_name,
    last_name,
    preferred_name: null,
  });
  const OUTCOMES = {
    funds: [
      { name: "Passes on", group_name: "Grace", outcome: "passed_on", recipient: named("ben") },
      { name: "No second", group_name: "Grace", outcome: "needs_recipient", recipient: null },
      { name: "Second left", group_name: "Grace", outcome: "needs_recipient", recipient: null },
    ],
    household: null,
  };

  function withOutcomes(outcomes: unknown, overrides: Partial<Tables> = {}) {
    const fake = setup(overrides);
    fake.state.rpcResults.person_deletion_outcomes = outcomes;
    return fake;
  }

  it("asks the database for the outcomes, in the caller's church", async () => {
    const { log } = withOutcomes(OUTCOMES);
    await loadDeletionSummary(ORG, "ada", "self");
    expect(log.rpcs).toEqual([{ name: "person_deletion_outcomes", args: { _person_id: "ada", _org_id: ORG } }]);
  });

  it("is null for someone in another church", async () => {
    withOutcomes(null);
    expect(await loadDeletionSummary(ORG, "outsider", "church_admin")).toBeNull();
  });

  it("is null when the database knows no such person in this church", async () => {
    withOutcomes(null);
    expect(await loadDeletionSummary(ORG, "ada", "self")).toBeNull();
  });

  it("names the person being deleted by their email when they have no name", async () => {
    withOutcomes(OUTCOMES, {
      profiles: [person("ada", { first_name: null, last_name: null, email: "ada@example.test" })],
    });
    expect((await loadDeletionSummary(ORG, "ada", "church_admin"))?.name).toBe("ada@example.test");
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.name).toBe("ada@example.test");
  });

  it("never names a second person by their email", async () => {
    withOutcomes({
      ...OUTCOMES,
      funds: [{ ...OUTCOMES.funds[0], recipient: named(null, null) }],
    });
    const summary = await loadDeletionSummary(ORG, "ada", "self");
    expect(summary?.groupContent).toMatchObject({
      fundsPassedOn: [{ name: "Passes on", recipient: "No name on file" }],
    });
  });

  it("names each fund's outcome for the person, as the database gives it", async () => {
    withOutcomes(OUTCOMES);
    const summary = await loadDeletionSummary(ORG, "ada", "self");
    expect(summary?.groupContent).toEqual({
      kind: "names",
      fundsPassedOn: [{ name: "Passes on", group: "Grace", recipient: "ben Test" }],
      fundsNeedingRecipient: [
        { name: "No second", group: "Grace" },
        { name: "Second left", group: "Grace" },
      ],
      groupsLosingLeader: [],
    });
  });

  it("gives a church admin counts, with no fund or group name anywhere in the answer", async () => {
    withOutcomes(OUTCOMES, {
      group_members: [{ org_id: ORG, group_id: "g3", profile_id: "ada", role: "leader", groups: { name: "Alone" } }],
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
    withOutcomes(OUTCOMES, {
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
    const household = {
      name: "Okafor",
      goes: true,
      entries: [{ first_name: "Kid", last_name: "O", preferred_name: null }],
    };
    withOutcomes({ ...OUTCOMES, household });
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.household).toEqual({
      name: "Okafor",
      shared: false,
      entries: ["Kid O"],
    });

    withOutcomes({ ...OUTCOMES, household: { ...household, goes: false } });
    expect((await loadDeletionSummary(ORG, "ada", "church_admin"))?.household?.shared).toBe(true);
  });

  it("has no household for someone in none", async () => {
    withOutcomes(OUTCOMES);
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.household).toBeNull();
  });

  it("flags the last church admin", async () => {
    withOutcomes(OUTCOMES, { profiles: [person("ada", { role: "admin" })] });
    expect((await loadDeletionSummary(ORG, "ada", "self"))?.lastChurchAdmin).toBe(true);
  });

  it("flags a platform operator", async () => {
    withOutcomes(OUTCOMES, { platform_admins: [{ profile_id: "ada" }] });
    expect((await loadDeletionSummary(ORG, "ada", "church_admin"))?.platformOperator).toBe(true);
    expect((await loadDeletionSummary(ORG, "ben", "church_admin"))?.platformOperator).toBe(false);
  });

  it("throws rather than answer from a failed read", async () => {
    const { failures } = withOutcomes(OUTCOMES);
    failures.push({ table: "platform_admins", op: "select" });
    await expect(loadDeletionSummary(ORG, "ada", "self")).rejects.toThrow();
  });

  describe("the answer person_deletion_outcomes() gives", () => {
    // The pgTAP suite asserts the real function returns this literal, ids aside.
    const suite = readFileSync("supabase/tests/deletion_outcomes_suite.sql", "utf8");
    const literal = suite.split("-- deletion outcome shape: begin")[1]?.split("-- deletion outcome shape: end")[0] ?? "";
    const outcomes: unknown = JSON.parse(literal.trim().slice(1, -1));

    it("passes the shape check", () => {
      expect(parseDeletionOutcomes(outcomes)).toEqual(outcomes);
    });

    it("is what the confirmation shows", async () => {
      withOutcomes(outcomes);
      const summary = await loadDeletionSummary(ORG, "ada", "self");
      expect(summary?.groupContent).toEqual({
        kind: "names",
        fundsPassedOn: [{ name: "passes_on", group: "Outcomes Group", recipient: "Sam Second" }],
        fundsNeedingRecipient: [
          { name: "no_second", group: "Outcomes Group" },
          { name: "pending_second", group: "Outcomes Group" },
        ],
        groupsLosingLeader: [],
      });
      expect(summary?.household).toEqual({ name: "Shared", shared: true, entries: ["Kid Shared", "Spouse Shared"] });
    });
  });

  it.each([
    ["a renamed fund outcome", { ...OUTCOMES, funds: [{ ...OUTCOMES.funds[1], outcome: "no_recipient" }] }],
    ["a passed-on fund without its recipient", { ...OUTCOMES, funds: [{ ...OUTCOMES.funds[0], recipient: null }] }],
    ["a renamed funds key", { fund_list: OUTCOMES.funds, household: null }],
    ["a household without goes", { ...OUTCOMES, household: { name: "Okafor", stays: false, entries: [] } }],
  ])("throws rather than answer from outcomes with %s", async (_, outcomes) => {
    withOutcomes(outcomes);
    await expect(loadDeletionSummary(ORG, "ada", "self")).rejects.toThrow();
  });

  it("throws rather than answer when the outcomes can't be read", async () => {
    const { state } = withOutcomes(OUTCOMES);
    state.rpcError = { code: "XX000" };
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
