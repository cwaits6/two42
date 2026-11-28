import { beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.fn(() => true);
vi.mock("./enabled", () => ({ recordsIntegrationEnabled: () => enabled() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

let answers: Record<string, { data: unknown; error: unknown }>;
let filters: string[];
const query = (table: string) => {
  const result = Promise.resolve(answers[table]);
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    neq: (column: string, value: string) => (filters.push(`${table}.${column}<>${value}`), chain),
    maybeSingle: () => result,
    then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => result.then(resolve, reject),
  };
  return chain;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query }) }));

const { readHouseholdRecords, readProfileRecords } = await import("./profileRecords");

beforeEach(() => {
  enabled.mockReturnValue(true);
  filters = [];
  answers = {
    records_field_settings: { data: [{ field: "name", mode: "locked" }], error: null },
    records_field_values: {
      data: [
        { profile_id: "me", field: "name", state: "records", church_value: { first_name: "Ada", last_name: "Okafor" } },
        { profile_id: "spouse", field: "anniversary", state: "changed", church_value: { anniversary_month: 6 } },
      ],
      error: null,
    },
    records_person_state: { data: { notice_filled_at: "2026-11-26T03:00:00Z", notice_seen_at: null }, error: null },
    records_household_values: { data: [{ field: "address", state: "records", church_value: { city: "Austin" } }], error: null },
    records_household_anniversary: { data: { state: "cleared", church_value: { anniversary_month: 6 } }, error: null },
  };
});

describe("readProfileRecords", () => {
  it("gives each person their own sources, and the notice only to the signed-in person", async () => {
    const read = await readProfileRecords(["me", "spouse"], "me");
    if (!read.ok) throw new Error("expected a read");
    expect(read.byProfile.me.values.name?.state).toBe("records");
    expect(read.byProfile.me.noticeDue).toBe(true);
    expect(read.byProfile.spouse.noticeDue).toBe(false);
    expect(read.byProfile.spouse.settings).toEqual({ name: "locked" });
    expect(filters).toEqual(["records_field_values.field<>anniversary"]);
  });

  it("fails closed when a read fails, so no form offers a locked field", async () => {
    answers.records_field_values = { data: null, error: { message: "boom" } };
    expect(await readProfileRecords(["me"], "me")).toEqual({ ok: false });
  });

  it("reads the household's anniversary from its own source, beside its address", async () => {
    const read = await readHouseholdRecords("home");
    if (!read.ok) throw new Error("expected a read");
    expect(read.records?.values).toEqual({
      address: { state: "records", churchValue: { city: "Austin" } },
      anniversary: { state: "cleared", churchValue: { anniversary_month: 6 } },
    });
  });

  it("gives a household with no details from the records no labels", async () => {
    answers.records_household_values = { data: [], error: null };
    answers.records_household_anniversary = { data: null, error: null };
    expect(await readHouseholdRecords("home")).toEqual({ ok: true, records: null });
  });

  it("still reads the sources while the integration is off, since the database keeps enforcing a lock", async () => {
    enabled.mockReturnValue(false);
    const read = await readProfileRecords(["me"], "me");
    expect(read.ok && read.byProfile.me.settings).toEqual({ name: "locked" });
  });
});
