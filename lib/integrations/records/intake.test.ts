import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordsError } from "./errors";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let claim: string;
let accepted: string | null;
let updateError: Row | null;
const updates: { table: string; values: Row; filters: Row }[] = [];
const rpcs: { name: string; args: Row }[] = [];

function query(table: string) {
  const tests: ((row: Row) => boolean)[] = [];
  const filters: Row = {};
  let values: Row | null = null;
  let deleting = false;
  let counting = false;
  let order: { column: string; ascending: boolean } | null = null;
  let limit = Infinity;
  const rows = () => {
    const found = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
    if (order) {
      const { column, ascending } = order;
      found.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    return found.slice(0, limit);
  };
  const chain = {
    select: (_columns?: string, options?: { count?: string }) => ((counting = options?.count === "exact"), chain),
    update: (v: Row) => ((values = v), chain),
    delete: () => ((deleting = true), chain),
    eq: (column: string, value: unknown) => ((filters[column] = value), tests.push((row) => row[column] === value), chain),
    in: (column: string, list: unknown[]) => (tests.push((row) => list.includes(row[column])), chain),
    gte: (column: string, value: string) => (tests.push((row) => String(row[column]) >= value), chain),
    lt: (column: string, value: string) => (tests.push((row) => row[column] != null && String(row[column]) < value), chain),
    order: (column: string, options: { ascending: boolean }) => ((order = { column, ...options }), chain),
    limit: (n: number) => ((limit = n), chain),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => void) => {
      if (values) updates.push({ table, values, filters: { ...filters } });
      if (deleting) {
        const gone = new Set(rows());
        tables[table] = (tables[table] ?? []).filter((row) => !gone.has(row));
      }
      resolve({ data: rows(), count: counting ? rows().length : null, error: values ? updateError : null });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  createServiceClient: async () => ({
    from: query,
    rpc: async (name: string, args: Row) => {
      rpcs.push({ name, args });
      if (name === "records_intake_accept") return { data: accepted, error: null };
      if (name === "records_intake_withdraw") {
        // The function's upsert: a consent not yet claimed becomes a kept withdrawal.
        const rows = tables.records_intake_requests;
        const row = rows.find((r) => r.org_id === args._org_id && r.profile_id === args._profile_id);
        if (!row) rows.push({ org_id: args._org_id, profile_id: args._profile_id, state: "withdrawn" });
        else if (row.state === "consented" || row.state === "withdrawn") row.state = "withdrawn";
        else return { data: "too_late", error: null };
        return { data: "withdrawn", error: null };
      }
      return { data: claim, error: null };
    },
  }),
}));

const log = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/log", () => log);

vi.mock("./crypto", () => ({
  openKey: (_secret: Buffer, org: string, label: string, sealed: string) => {
    if (sealed === "sealed-under-old-secret") throw new Error("unsupported state or unable to authenticate data");
    return `${org}|${label}|${sealed}`;
  },
}));

const submitNewPerson = vi.fn();
const stubIntake = {
  setup: { keyLabel: "Write key", keyHelp: "", destinationLabel: "inbox", destinationHelp: "" },
  parseDestinationId: (v: unknown) => String(v),
  destinations: vi.fn(),
  checkDestination: vi.fn(),
  submitNewPerson,
};
vi.mock("./providers", () => ({
  providerFor: (id: unknown) => (id === "stub" ? { id: "stub", label: "Stub Records", intake: stubIntake } : null),
}));

const { acceptConsent, INTAKE_UNKNOWN_AFTER_MS, intakeOffer, readIntakeStatus, sendNewPerson, withdrawConsent } = await import(
  "./intake"
);

const ORG = "org-1";
const SECRET = Buffer.alloc(32);
const person = { firstName: "Nora", lastName: "Setupwell", email: "nora@example.test", phone: "5551234567" };

beforeEach(() => {
  vi.clearAllMocks();
  submitNewPerson.mockReset().mockResolvedValue(undefined);
  updates.length = 0;
  rpcs.length = 0;
  claim = "claimed";
  accepted = "acc-1";
  updateError = null;
  tables = {
    records_connections: [
      { org_id: ORG, provider: "stub", base_url: "https://records.example.test", connection_id: "c1" },
      { org_id: "org-2", provider: "stub", base_url: "https://other.example.test", connection_id: "c2" },
    ],
    records_intake_settings: [{ org_id: ORG, connection_id: "c1", key_ciphertext: "sealed", destination_id: "42" }],
    records_person_links: [],
    records_intake_requests: [],
  };
});

describe("sendNewPerson", () => {
  it("claims the send, sends only the person's name, email and phone with the write key, and records it sent", async () => {
    await sendNewPerson(ORG, "p1", "acc-1", person, SECRET);
    expect(rpcs).toEqual([{ name: "records_intake_claim", args: { _org_id: ORG, _profile_id: "p1", _accept_id: "acc-1" } }]);
    expect(submitNewPerson).toHaveBeenCalledTimes(1);
    expect(submitNewPerson).toHaveBeenCalledWith(
      { baseUrl: "https://records.example.test", key: `${ORG}|stub-intake|sealed` },
      "42",
      person,
    );
    expect(updates).toEqual([
      {
        table: "records_intake_requests",
        values: expect.objectContaining({ state: "sent", failure: null }),
        filters: { org_id: ORG, profile_id: "p1", state: "sending" },
      },
    ]);
  });

  it.each(["unauthorized", "not_found", "unreachable", "not_provider", "rejected"] as const)(
    "records a %s refusal as failed, logging no details",
    async (failure) => {
      submitNewPerson.mockRejectedValue(new RecordsError(failure, 403));
      await sendNewPerson(ORG, "p1", "acc-1", person, SECRET);
      expect(updates[0].values).toEqual(expect.objectContaining({ state: "failed", failure }));
      expect(log.logWarn).toHaveBeenCalledWith("Church records new person not sent", undefined, {
        route: "/api/church-records/intake",
        step: failure,
        ids: { org: ORG, user: "p1" },
      });
      expect(JSON.stringify([log.logWarn.mock.calls, log.logError.mock.calls])).not.toMatch(/Nora|Setupwell|nora@|555/);
    },
  );

  it.each(["stale", "linked", "off"])("sends nothing and records nothing when the claim answers %s", async (answer) => {
    claim = answer;
    await sendNewPerson(ORG, "p1", "acc-1", person, SECRET);
    expect(submitNewPerson).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(log.logWarn).not.toHaveBeenCalled();
  });

  it("records a claimed send failed when the write key won't open or can't be found, logging no details", async () => {
    tables.records_intake_settings = [
      { org_id: ORG, connection_id: "c1", key_ciphertext: "sealed-under-old-secret", destination_id: "42" },
    ];
    await sendNewPerson(ORG, "p1", "acc-1", person, SECRET);
    tables.records_intake_settings = [{ org_id: ORG, connection_id: "old", key_ciphertext: "sealed", destination_id: "42" }];
    await sendNewPerson(ORG, "p2", "acc-2", person, SECRET);
    expect(submitNewPerson).not.toHaveBeenCalled();
    expect(updates.map((u) => [u.filters.profile_id, u.values.state, u.values.failure])).toEqual([
      ["p1", "failed", "unauthorized"],
      ["p2", "failed", "unauthorized"],
    ]);
    expect(log.logError).toHaveBeenCalledWith("Church records new person send failed", expect.anything(), {
      route: "/api/church-records/intake",
      step: "key",
      ids: { org: ORG, user: "p1" },
    });
    expect(log.logWarn).toHaveBeenCalledWith("Church records new person not sent", undefined, {
      route: "/api/church-records/intake",
      step: "key",
      ids: { org: ORG, user: "p2" },
    });
    expect(JSON.stringify([log.logWarn.mock.calls, log.logError.mock.calls])).not.toMatch(/Nora|Setupwell|nora@|555/);
  });

  it("never reads another church's setting", async () => {
    await sendNewPerson("org-2", "p1", "acc-1", person, SECRET);
    expect(submitNewPerson).not.toHaveBeenCalled();
  });

  it("logs a result it can't record, and never throws", async () => {
    updateError = { code: "08006", message: "connection lost" };
    await expect(sendNewPerson(ORG, "p1", "acc-1", person, SECRET)).resolves.toBeUndefined();
    expect(log.logError).toHaveBeenCalledWith("Church records new person send failed", expect.anything(), {
      route: "/api/church-records/intake",
      ids: { org: ORG, user: "p1" },
    });
  });
});

describe("intakeOffer", () => {
  it("asks only while sending is on and the person is neither linked nor already asked", async () => {
    expect(await intakeOffer(ORG, "p1")).toBe("ask");
    tables.records_intake_requests = [{ org_id: ORG, profile_id: "p1", state: "consented" }];
    expect(await intakeOffer(ORG, "p1")).toBe("consented");
    tables.records_intake_requests = [{ org_id: ORG, profile_id: "p1", state: "withdrawn" }];
    expect(await intakeOffer(ORG, "p1")).toBe("ask");
    tables.records_intake_requests = [{ org_id: ORG, profile_id: "p1", state: "failed" }];
    expect(await intakeOffer(ORG, "p1")).toBe("done");
    tables.records_intake_requests = [];
    tables.records_person_links = [{ org_id: ORG, profile_id: "p1" }];
    expect(await intakeOffer(ORG, "p1")).toBe("done");
    tables.records_intake_settings = [];
    expect(await intakeOffer(ORG, "p1")).toBe("off");
  });
});

describe("acceptConsent", () => {
  it("returns the acceptance a deferred send claims with, or null when there is nothing to send", async () => {
    expect(await acceptConsent(ORG, "p1")).toBe("acc-1");
    expect(rpcs).toEqual([{ name: "records_intake_accept", args: { _org_id: ORG, _profile_id: "p1" } }]);
    accepted = null;
    expect(await acceptConsent(ORG, "p1")).toBeNull();
  });
});

describe("withdrawConsent", () => {
  it("keeps a withdrawal in place of a consent not yet sent, and leaves a send already made alone", async () => {
    tables.records_intake_requests = [
      { org_id: ORG, profile_id: "sent", state: "sent" },
      { org_id: ORG, profile_id: "failed", state: "failed" },
      { org_id: ORG, profile_id: "waiting", state: "consented" },
      { org_id: "org-2", profile_id: "waiting", state: "consented" },
    ];
    const results = [];
    for (const id of ["sent", "failed", "waiting", "never"]) results.push(await withdrawConsent(ORG, id));
    expect(results).toEqual(["too_late", "too_late", "withdrawn", "withdrawn"]);
    expect(rpcs.map((r) => r.name)).toEqual(Array(4).fill("records_intake_withdraw"));
    expect(await intakeOffer(ORG, "sent")).toBe("done");
    expect(await intakeOffer(ORG, "failed")).toBe("done");
    expect(await intakeOffer(ORG, "waiting")).toBe("ask");
    expect(tables.records_intake_requests).toContainEqual({ org_id: ORG, profile_id: "never", state: "withdrawn" });
    expect(tables.records_intake_requests).toContainEqual({ org_id: "org-2", profile_id: "waiting", state: "consented" });
  });
});

describe("readIntakeStatus", () => {
  const SINCE = "2026-11-20T00:00:00.000Z";
  const row = (profile_id: string, state: string, finished_at: string | null, failure: string | null = null) => ({
    org_id: ORG,
    profile_id,
    state,
    failure,
    finished_at,
  });

  it("counts every send, and names the newest failure only when it is newer than the setting", async () => {
    tables.records_intake_requests = [
      row("a", "failed", "2026-11-10T00:00:00.000Z", "unreachable"),
      row("b", "failed", "2026-11-21T00:00:00.000Z", "not_found"),
      row("c", "failed", "2026-11-22T00:00:00.000Z", "unauthorized"),
      row("d", "sent", "2026-11-21T12:00:00.000Z"),
      row("e", "consented", null),
      { ...row("f", "failed", "2026-11-23T00:00:00.000Z", "rejected"), org_id: "org-2" },
    ];
    expect(await readIntakeStatus(ORG, SINCE)).toEqual({ sent: 1, failed: 3, unknown: 0, lastFailure: "unauthorized" });

    tables.records_intake_requests.push(row("g", "sent", "2026-11-24T00:00:00.000Z"));
    expect((await readIntakeStatus(ORG, SINCE)).lastFailure).toBeNull();

    tables.records_intake_requests = [row("a", "failed", "2026-11-10T00:00:00.000Z", "unreachable")];
    expect(await readIntakeStatus(ORG, SINCE)).toEqual({ sent: 0, failed: 1, unknown: 0, lastFailure: null });
  });

  it("counts a claimed send left unfinished as an unknown outcome once it is old enough", async () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    tables.records_intake_requests = [
      { ...row("old", "sending", null), claimed_at: ago(INTAKE_UNKNOWN_AFTER_MS + 60_000) },
      { ...row("fresh", "sending", null), claimed_at: ago(1_000) },
      { ...row("elsewhere", "sending", null), claimed_at: ago(INTAKE_UNKNOWN_AFTER_MS + 60_000), org_id: "org-2" },
    ];
    expect(await readIntakeStatus(ORG, SINCE)).toEqual({ sent: 0, failed: 0, unknown: 1, lastFailure: null });
  });
});
