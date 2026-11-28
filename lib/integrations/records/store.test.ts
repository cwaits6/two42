import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

// Applies the filters readCopyStatus sends, so a narrowed filter or a broken
// join shows up as a wrong list rather than passing against a canned answer.
function query(table: string) {
  const tests: ((row: Row) => boolean)[] = [];
  let head = false;
  const rows = () => (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
  const chain = {
    select: (_columns: string, options?: { count?: string; head?: boolean }) => ((head = !!options?.head), chain),
    eq: (column: string, value: unknown) => (tests.push((row) => row[column] === value), chain),
    in: (column: string, values: unknown[]) => (tests.push((row) => values.includes(row[column])), chain),
    or: (filters: string) => {
      const notNull = filters.split(",").map((f) => {
        const [column, ...rest] = f.split(".");
        if (rest.join(".") !== "not.is.null") throw new Error(`unexpected filter ${f}`);
        return column;
      });
      tests.push((row) => notNull.some((column) => row[column] != null));
      return chain;
    },
    order: () => chain,
    range: (from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }),
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => void) =>
      resolve(head ? { count: rows().length, data: null, error: null } : { data: rows(), error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({ from: query }) }));

const { readCopyStatus, readLiveSources } = await import("./store");

const ORG = "org-1";
const link = (profile_id: string, external_person_id: string, org_id = ORG) => ({ org_id, profile_id, external_person_id });
const state = (profile_id: string, values: Row, org_id = ORG) => ({
  org_id,
  profile_id,
  copied_at: null,
  review_reason: null,
  review_since: null,
  ...values,
});

beforeEach(() => {
  tables = {
    records_refresh_state: [{ org_id: ORG, last_refreshed_at: "2026-11-26T08:00:00Z" }],
    records_person_links: [
      link("inactive", "101"),
      link("missing", "102"),
      link("copied", "103"),
      link("never", "104"),
      link("asked-again", "105"),
      link("other-church", "900", "org-2"),
    ],
    records_person_state: [
      state("inactive", { copied_at: "2026-11-25T08:00:00Z", review_reason: "inactive", review_since: "2026-11-25T08:00:00Z" }),
      state("missing", { review_reason: "missing", review_since: "2026-11-24T08:00:00Z" }),
      state("copied", { copied_at: "2026-11-25T08:00:00Z" }),
      state("asked-again", {}),
      state("other-church", { review_reason: "missing" }, "org-2"),
    ],
    profiles: [
      { org_id: ORG, id: "inactive", first_name: "Ada", preferred_name: null, last_name: "Okafor", suffix: null },
      { org_id: ORG, id: "missing", first_name: "Ben", preferred_name: null, last_name: "Adler", suffix: null },
      { org_id: ORG, id: "copied", first_name: "Cy", preferred_name: null, last_name: "Ng", suffix: null },
    ],
  };
});

describe("readCopyStatus", () => {
  it("lists inactive and missing people for review, and counts who is still to copy", async () => {
    const status = await readCopyStatus(ORG);
    expect(status.review).toEqual([
      { profileId: "inactive", personId: "101", name: "Ada Okafor", reason: "inactive", since: "2026-11-25T08:00:00Z" },
      { profileId: "missing", personId: "102", name: "Ben Adler", reason: "missing", since: "2026-11-24T08:00:00Z" },
    ]);
    // Never copied, and asked to copy again by a settings change.
    expect(status.pending).toBe(2);
    expect(status.lastRefreshedAt).toBe("2026-11-26T08:00:00Z");
  });

  it("leaves out someone whose profile is gone, and anyone in another church", async () => {
    tables.profiles = tables.profiles.filter((p) => p.id !== "missing");
    const status = await readCopyStatus(ORG);
    expect(status.review.map((r) => r.profileId)).toEqual(["inactive"]);
  });
});

describe("readLiveSources", () => {
  it("reads only the people and households asked for, in this church, and no value from the records", async () => {
    tables.records_field_settings = [
      { org_id: ORG, field: "birthday", mode: "member" },
      { org_id: ORG, field: "phone_mobile", mode: "member" },
      { org_id: "org-2", field: "address", mode: "member" },
    ];
    tables.records_field_values = [
      { org_id: ORG, profile_id: "copied", field: "birthday", state: "cleared", church_value: { birth_month: 1 } },
      { org_id: ORG, profile_id: "copied", field: "phone_mobile", state: "changed" },
      { org_id: ORG, profile_id: "copied", field: "anniversary", state: "changed" },
      { org_id: "org-2", profile_id: "never", field: "birthday", state: "changed" },
    ];
    tables.records_household_anniversary = [
      { org_id: ORG, family_id: "home", state: "cleared", church_value: { anniversary_month: 6 } },
      { org_id: ORG, family_id: "elsewhere", state: "changed" },
      { org_id: "org-2", family_id: "home", state: "records" },
    ];
    tables.records_household_links = [
      { org_id: ORG, family_id: "home", external_family_id: "500" },
      { org_id: "org-2", family_id: "home", external_family_id: "900" },
    ];
    tables.records_household_values = [{ org_id: ORG, family_id: "home", field: "address", state: "changed" }];
    tables.records_child_suggestions = [
      { org_id: ORG, family_member_id: "kid", external_person_id: "700", state: "added" },
      { org_id: ORG, family_member_id: "open-kid", external_person_id: "701", state: "open" },
    ];

    const sources = await readLiveSources(
      ORG,
      { profiles: ["copied", "never"], households: ["home"], members: ["kid", "open-kid"] },
      true,
    );
    expect([...sources.fields]).toEqual(["birthday"]);
    expect([...sources.personLinks]).toEqual([["copied", "103"], ["never", "104"]]);
    expect([...sources.personStates]).toEqual([["copied:birthday", "cleared"]]);
    expect([...sources.householdLinks]).toEqual([["home", "500"]]);
    expect([...sources.addressStates]).toEqual([["home", "changed"]]);
    expect([...sources.anniversaryStates]).toEqual([["home", "cleared"]]);
    expect([...sources.children]).toEqual([["kid", "700"]]);
    expect(JSON.stringify(sources, (_k, v) => (v instanceof Map || v instanceof Set ? [...v] : v))).not.toContain(
      "birth_month",
    );
  });

  it("asks nothing about children while the church doesn't suggest them", async () => {
    tables.records_field_settings = [];
    tables.records_child_suggestions = [{ org_id: ORG, family_member_id: "kid", external_person_id: "700", state: "added" }];
    const sources = await readLiveSources(ORG, { profiles: [], households: [], members: ["kid"] }, false);
    expect(sources.children.size).toBe(0);
  });
});
