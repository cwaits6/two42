import { beforeEach, describe, expect, it, vi } from "vitest";

const enabled = vi.fn(() => true);
vi.mock("./enabled", () => ({ recordsIntegrationEnabled: () => enabled() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

let answers: Record<string, { data: unknown; error: unknown }>;
const query = (table: string) => {
  const result = Promise.resolve(answers[table]);
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: () => result,
    then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => result.then(resolve, reject),
  };
  return chain;
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query }) }));

const { readProfileRecords, householdAnniversary } = await import("./profileRecords");

beforeEach(() => {
  enabled.mockReturnValue(true);
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
    expect(householdAnniversary(read.byProfile)?.values.anniversary?.state).toBe("changed");
  });

  it("shows no anniversary source while the household's linked people's differ", async () => {
    answers.records_field_values = {
      data: [
        { profile_id: "me", field: "anniversary", state: "records", church_value: { anniversary_month: 6, anniversary_day: 14 } },
        { profile_id: "spouse", field: "anniversary", state: "records", church_value: { anniversary_month: 7, anniversary_day: 2 } },
      ],
      error: null,
    };
    const read = await readProfileRecords(["me", "spouse"], "me");
    if (!read.ok) throw new Error("expected a read");
    expect(householdAnniversary(read.byProfile)).toBeNull();
  });

  it("fails closed when a read fails, so no form offers a locked field", async () => {
    answers.records_field_values = { data: null, error: { message: "boom" } };
    expect(await readProfileRecords(["me"], "me")).toEqual({ ok: false });
  });

  it("reads nothing while the integration is off", async () => {
    enabled.mockReturnValue(false);
    expect(await readProfileRecords(["me"], "me")).toEqual({
      ok: true,
      byProfile: { me: { settings: {}, values: {}, noticeDue: false } },
    });
  });
});
