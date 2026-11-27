import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordsError } from "./errors";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let claim: string;
let updateError: Row | null;
const updates: { table: string; values: Row; filters: Row }[] = [];
const rpcs: { name: string; args: Row }[] = [];

function query(table: string) {
  const filters: Row = {};
  let values: Row | null = null;
  const rows = () => (tables[table] ?? []).filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
  const chain = {
    select: () => chain,
    update: (v: Row) => ((values = v), chain),
    eq: (column: string, value: unknown) => ((filters[column] = value), chain),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => void) => {
      if (values) updates.push({ table, values, filters: { ...filters } });
      resolve({ data: rows(), error: values ? updateError : null });
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
      return { data: claim, error: null };
    },
  }),
}));

const log = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock("@/lib/log", () => log);

vi.mock("./crypto", () => ({
  openKey: (_secret: Buffer, org: string, label: string, sealed: string) => `${org}|${label}|${sealed}`,
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
  intakeOf: (provider: { intake?: unknown } | null) => provider?.intake ?? null,
}));

const { intakeOffer, sendNewPerson } = await import("./intake");

const ORG = "org-1";
const SECRET = Buffer.alloc(32);
const person = { firstName: "Nora", lastName: "Setupwell", email: "nora@example.test", phone: "5551234567" };

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  rpcs.length = 0;
  claim = "claimed";
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
    await sendNewPerson(ORG, "p1", person, SECRET);
    expect(rpcs).toEqual([{ name: "records_intake_claim", args: { _org_id: ORG, _profile_id: "p1" } }]);
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
      await sendNewPerson(ORG, "p1", person, SECRET);
      expect(updates[0].values).toEqual(expect.objectContaining({ state: "failed", failure }));
      expect(log.logWarn).toHaveBeenCalledWith("Church records new person not sent", undefined, {
        route: "/api/church-records/intake",
        step: failure,
        ids: { org: ORG, user: "p1" },
      });
      expect(JSON.stringify([log.logWarn.mock.calls, log.logError.mock.calls])).not.toMatch(/Nora|Setupwell|nora@|555/);
    },
  );

  it.each(["already", "linked", "off"])("sends nothing when the claim answers %s", async (answer) => {
    claim = answer;
    await sendNewPerson(ORG, "p1", person, SECRET);
    expect(submitNewPerson).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("sends nothing, and claims nothing, while sending is off or set for a replaced connection", async () => {
    tables.records_intake_settings = [];
    await sendNewPerson(ORG, "p1", person, SECRET);
    tables.records_intake_settings = [{ org_id: ORG, connection_id: "old", key_ciphertext: "sealed", destination_id: "42" }];
    await sendNewPerson(ORG, "p1", person, SECRET);
    expect(rpcs).toEqual([]);
    expect(submitNewPerson).not.toHaveBeenCalled();
  });

  it("never reads another church's setting", async () => {
    await sendNewPerson("org-2", "p1", person, SECRET);
    expect(submitNewPerson).not.toHaveBeenCalled();
  });

  it("logs a result it can't record, and never throws", async () => {
    updateError = { code: "08006", message: "connection lost" };
    await expect(sendNewPerson(ORG, "p1", person, SECRET)).resolves.toBeUndefined();
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
    tables.records_intake_requests = [{ org_id: ORG, profile_id: "p1", state: "failed" }];
    expect(await intakeOffer(ORG, "p1")).toBe("done");
    tables.records_intake_requests = [];
    tables.records_person_links = [{ org_id: ORG, profile_id: "p1" }];
    expect(await intakeOffer(ORG, "p1")).toBe("done");
    tables.records_intake_settings = [];
    expect(await intakeOffer(ORG, "p1")).toBe("off");
  });
});
