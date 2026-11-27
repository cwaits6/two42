// The copy's field table is owned by supabase/functions/_shared/records-copy.ts
// and restated in SQL, where nothing else ties the two: a field added on one
// side only would be copied and never detached or locked, or refused.
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FIELD_COLUMNS,
  FIELD_TABLE,
  LIVE_ONLY_FIELDS,
  LOCKABLE_FIELDS,
  PROFILE_COPY_COLUMNS,
  RECORDS_FIELDS,
  RECORDS_MODES,
  VALUE_STATES,
  type ValueField,
} from "@/supabase/functions/_shared/records-copy";
import { HIDEABLE_FIELDS } from "@/lib/integrations/records/livePlan";
import {
  ADDRESS_COLUMNS,
  type ChildRow,
  CONFIRM_HOUSEHOLD_OUTCOMES,
  HOUSEHOLD_COPY_COLUMNS,
  HOUSEHOLD_FIELD_COLUMNS,
  HOUSEHOLD_FIELDS,
  type HouseholdSuggestion,
  type HouseholdValueRow,
  SAVE_SETTING_OUTCOMES,
  type SuggestedPerson,
  type SuggestionBasis,
} from "@/supabase/functions/_shared/records-households";
import {
  APPLY_HOUSEHOLD_OUTCOMES,
  APPLY_OUTCOMES,
  type ApplyHouseholdCopyArgs,
  LEASE_MS,
} from "@/supabase/functions/_shared/records-refresh";

const copySql = readFileSync("supabase/migrations/20261209000000_church_records_copy.sql", "utf8");
const householdsSql = readFileSync("supabase/migrations/20261210000000_church_records_households.sql", "utf8");
const liveSql = readFileSync("supabase/migrations/20261211000000_church_records_live.sql", "utf8");
let sql = copySql;

const migrations = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"));

/** A function's body as its latest migration defines it, so a later create or replace is the one checked. */
function fn(name: string): string {
  const heads = [`create or replace function public.${name}(`, `create function public.${name}(`];
  for (const text of [...migrations].reverse()) {
    const [at, head] = heads
      .map((h) => [text.lastIndexOf(h), h] as const)
      .reduce((a, b) => (b[0] > a[0] ? b : a));
    if (at < 0) continue;
    const to = text.indexOf("$$;", at);
    expect(to, name).toBeGreaterThan(at);
    return text.slice(at + head.length, to);
  }
  throw new Error(`no migration defines public.${name}()`);
}

const quoted = (text: string) => [...text.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
const sorted = (values: readonly string[]) => [...values].sort();

function between(start: string, end: string): string {
  const from = sql.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = sql.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return sql.slice(from + start.length, to);
}

function table(name: string): string {
  return between(`create table public.${name} (`, "\n);");
}

/** The column names of the jsonb_to_recordset(...) as <alias>(...) in a body. */
function recordset(body: string, alias: string): string[] {
  const match = [...body.matchAll(/jsonb_to_recordset\([^;]*?\)\s+as\s+(\w+)\(([^)]*)\)/g)].find((m) => m[1] === alias);
  expect(match, alias).toBeDefined();
  return (match?.[2] ?? "").split(",").map((c) => c.trim().split(/\s+/)[0]);
}

/** The keys a body reads off a jsonb value: <name> ->> 'key' and <name> -> 'key'. */
const keysRead = (body: string, name: string) =>
  [...body.matchAll(/(\w+) ->>? '([a-z_0-9]+)'/g)].filter((m) => m[1] === name).map((m) => m[2]);

// Typed literals: each lists exactly its type's keys, or the type check fails.
const SUGGESTED_PERSON: SuggestedPerson = { profile_id: "p", from_family_id: null, from_relationship: null, relationship: "primary" };
const SUGGESTION_BASIS: SuggestionBasis = { profile_id: "p", external_person_id: "e", family_id: null };
const SUGGESTION: HouseholdSuggestion = {
  external_family_id: "f",
  target_family_id: null,
  family_name: null,
  people: [SUGGESTED_PERSON],
  basis: [SUGGESTION_BASIS],
  ready: true,
};
const CHILD: ChildRow = {
  external_person_id: "c",
  first_name: "",
  last_name: "",
  birth_month: null,
  birth_day: null,
  graduation_year: null,
  photo: null,
};
const VALUE: HouseholdValueRow = { field: "address", state: "records", church_value: {} };
const EXPECTED: ApplyHouseholdCopyArgs["_expected"] = { family: "f", household: {}, states: {} };

describe("the copy migration agrees with the copy rules", () => {
  beforeEach(() => {
    sql = copySql;
  });

  it("lets only the same fields be locked", () => {
    const settings = table("records_field_settings");
    expect(sorted(quoted(settings.slice(settings.indexOf("records_field_settings_lockable"))))).toEqual(
      sorted(["member", ...LOCKABLE_FIELDS]),
    );
  });

  it("records a source for the same fields, in the same states", () => {
    const values = table("records_field_values");
    const fields = values.slice(values.indexOf("field text"), values.indexOf("state text"));
    expect(sorted(quoted(fields))).toEqual(sorted([...RECORDS_FIELDS, "preferred_name"]));
    const states = values.slice(values.indexOf("state text"), values.indexOf("church_value"));
    expect(sorted(quoted(states))).toEqual(sorted(VALUE_STATES));
  });

  it("maps each field to the same columns", () => {
    const body = between("create function public.records_field_columns(_field text)", "end;");
    const arms = Object.fromEntries(
      [...body.matchAll(/when '([a-z_]+)' then array\[([^\]]*)\]/g)].map((m) => [m[1], quoted(m[2])]),
    );
    expect(arms).toEqual(Object.fromEntries(Object.entries(FIELD_COLUMNS).map(([f, c]) => [f, [...c]])));
  });

  it("writes the same profile columns a copy plans", () => {
    const body = fn("records_apply_copy");
    const written = [...body.matchAll(/when _profile \? '([a-z_]+)'/g)].map((m) => m[1]);
    expect(sorted(written)).toEqual(sorted(PROFILE_COPY_COLUMNS));
  });

  it("leaves to their own triggers the fields that aren't on the profile", () => {
    const body = fn("records_profile_member_edit");
    const excluded = quoted(body.slice(body.indexOf("v.field not in ("), body.indexOf("loop")));
    const elsewhere = (Object.keys(FIELD_TABLE) as ValueField[]).filter((f) => FIELD_TABLE[f] !== "profile");
    expect(sorted(excluded)).toEqual(sorted(elsewhere));
  });

  it("answers a copy with the outcomes the refresh reads", () => {
    const body = fn("records_apply_copy");
    const answers = [...body.matchAll(/return ([^;]*);/g)].flatMap((m) => quoted(m[1]));
    expect(sorted([...new Set(answers)])).toEqual(sorted(APPLY_OUTCOMES));
  });

  it("writes and watches the same household and grade columns a copy plans", () => {
    const apply = fn("records_apply_copy");
    for (const [kind, table, arg] of [
      ["household", "family_units", "_household"],
      ["grade", "family_members", "_grade"],
    ] as const) {
      const fields = (Object.keys(FIELD_TABLE) as ValueField[]).filter((f) => FIELD_TABLE[f] === kind);
      const columns = sorted(fields.flatMap((f) => FIELD_COLUMNS[f]));
      const set = apply.slice(apply.indexOf(`update public.${table} set`), apply.indexOf("where", apply.indexOf(`update public.${table} set`)));
      // Each column is set from its own key, so two swapped keys fail here.
      const pairs = [...set.matchAll(new RegExp(`([a-z_]+) = \\(${arg} ->> '([a-z_]+)'\\)`, "g"))];
      expect(sorted(pairs.map((m) => m[1])), `${table} set`).toEqual(columns);
      for (const [, column, key] of pairs) expect(key, `${table}.${column}`).toBe(column);

      const watched = sql.match(new RegExp(`before update of ([a-z_, ]+) on public\\.${table}`))?.[1];
      expect(sorted(watched?.split(", ") ?? []), `${table} trigger columns`).toEqual(columns);

      const trigger = fn(`records_${kind}_member_edit`);
      const named = [...trigger.matchAll(/(?:field = |records_field_columns\()'([a-z_]+)'/g)].map((m) => m[1]);
      expect(sorted([...new Set(named)]), `${kind} trigger fields`).toEqual(sorted(fields));
    }
  });

  it("holds a settings save back for as long as a refresh's claim lasts", () => {
    const body = fn("records_save_field_settings");
    const minutes = Number(body.match(/interval '(\d+) minutes'/)?.[1]);
    expect(minutes * 60_000).toBe(LEASE_MS);
  });
});

describe("the households migration agrees with the household rules", () => {
  beforeEach(() => {
    sql = householdsSql;
  });

  it("lists the person and household fields to choose a setting for", () => {
    const check = between("add constraint records_field_settings_field_check check (", "));");
    expect(sorted(quoted(check))).toEqual(sorted([...RECORDS_FIELDS, ...HOUSEHOLD_FIELDS]));
  });

  it("finds the setting of a source whose field has none of its own as the copy does", () => {
    const settings = new Set<string>([...RECORDS_FIELDS, ...HOUSEHOLD_FIELDS]);
    const unset = [...RECORDS_FIELDS, "preferred_name"].filter((f) => !settings.has(f));
    const body = fn("records_save_field_settings");
    const cases = [...body.matchAll(/case v\.field ((?:when '[a-z_]+' then '[a-z_]+' )+)else v\.field end/g)];
    expect(cases.length).toBeGreaterThan(0);
    for (const [, arms] of cases) {
      const mapped = Object.fromEntries([...arms.matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
      expect(sorted(Object.keys(mapped))).toEqual(sorted(unset));
      expect(mapped).toEqual({ preferred_name: "name" });
    }
  });

  it("records a household source for the same fields, in the same states", () => {
    const values = table("records_household_values");
    expect(sorted(quoted(values.slice(values.indexOf("field text"), values.indexOf("state text"))))).toEqual(
      sorted(HOUSEHOLD_FIELDS),
    );
    expect(sorted(quoted(values.slice(values.indexOf("state text"), values.indexOf("church_value"))))).toEqual(
      sorted(VALUE_STATES),
    );
  });

  it("writes, and watches for a member's edit, the same household columns a copy plans", () => {
    const apply = fn("records_apply_household_copy");
    const update = apply.indexOf("update public.family_units set");
    const set = apply.slice(update, apply.indexOf("where id = _family_id", update));
    // Each column is set from its own key, so two swapped keys fail here.
    const pairs = [...set.matchAll(/([a-z_0-9]+) = case when _household \? '([a-z_0-9]+)' then _household ->> '([a-z_0-9]+)'/g)];
    const columns = sorted(HOUSEHOLD_FIELDS.flatMap((f) => HOUSEHOLD_FIELD_COLUMNS[f]));
    expect(sorted(pairs.map((m) => m[1]))).toEqual(columns);
    for (const [, column, key, read] of pairs) expect([key, read]).toEqual([column, column]);

    const watched = sql.match(/before update of ([a-z_0-9, ]+)\s+on public\.family_units/)?.[1];
    expect(sorted(watched?.split(", ") ?? [])).toEqual(sorted(HOUSEHOLD_COPY_COLUMNS));

    const trigger = fn("records_household_value_edit");
    const address = trigger.match(/when 'address' then array\[([^\]]*)\]/)?.[1] ?? "";
    expect(quoted(address)).toEqual([...HOUSEHOLD_FIELD_COLUMNS.address]);
    expect(trigger).toContain("else array['phone_home']");
  });

  it("answers a household copy with the outcomes the refresh reads", () => {
    const body = fn("records_apply_household_copy");
    const answers = [...body.matchAll(/return ([^;]*);/g)].flatMap((m) => quoted(m[1]));
    expect(sorted([...new Set(answers)])).toEqual(sorted(APPLY_HOUSEHOLD_OUTCOMES));
  });

  it("holds a settings save, the children switch and a household confirmation back for as long as a refresh's claim lasts", () => {
    for (const name of ["records_save_field_settings", "records_save_children_setting", "records_confirm_household"]) {
      const body = fn(name);
      const minutes = Number(body.match(/interval '(\d+) minutes'/)?.[1]);
      expect(minutes * 60_000, name).toBe(LEASE_MS);
    }
  });

  it("reads the household suggestions by the keys the refresh writes", () => {
    const replace = fn("records_replace_household_suggestions");
    expect(sorted(recordset(replace, "s"))).toEqual(sorted(Object.keys(SUGGESTION)));
    const confirm = fn("records_confirm_household");
    const people = [...recordset(confirm, "p"), ...keysRead(confirm, "p")];
    expect(sorted([...new Set(people)])).toEqual(sorted(Object.keys(SUGGESTED_PERSON)));
    expect(sorted([...new Set(keysRead(confirm, "b"))])).toEqual(sorted(Object.keys(SUGGESTION_BASIS)));
  });

  it("answers a household confirmation with the outcomes the app reads", () => {
    const body = fn("records_confirm_household");
    const answers = [...body.matchAll(/return ([^;]*);/g)].flatMap((m) => quoted(m[1]));
    expect(sorted([...new Set(answers)])).toEqual(sorted(CONFIRM_HOUSEHOLD_OUTCOMES));
  });

  it("answers a settings save and the children switch with the outcomes the app reads", () => {
    for (const name of ["records_save_field_settings", "records_save_children_setting"]) {
      const body = fn(name);
      const answers = [...body.matchAll(/return ([^;]*);/g)].flatMap((m) => quoted(m[1]));
      expect(sorted([...new Set(answers)]), name).toEqual(sorted(SAVE_SETTING_OUTCOMES));
    }
  });

  it("reads a household copy by the keys the refresh writes", () => {
    const body = fn("records_apply_household_copy");
    expect(sorted([...new Set(keysRead(body, "_expected"))])).toEqual(sorted(Object.keys(EXPECTED)));
    expect(sorted(recordset(body, "v"))).toEqual(sorted(Object.keys(VALUE)));
  });

  it("reads suggested children by the keys the refresh writes", () => {
    const body = fn("records_sync_child_suggestions");
    expect(sorted(recordset(body, "c"))).toEqual(sorted(Object.keys(CHILD)));
    for (const key of keysRead(body, "c")) expect(Object.keys(CHILD)).toContain(key);
  });

  it("refuses another household's child with the code the household tab reads", () => {
    const client = readFileSync("components/household/SuggestedChildren.tsx", "utf8");
    const code = client.match(/const NOT_AVAILABLE = "([A-Z0-9]{5})"/)?.[1];
    for (const name of ["records_add_suggested_child", "records_dismiss_suggested_child"]) {
      const body = fn(name);
      const codes = [...body.matchAll(/errcode = '([A-Z0-9]{5})'/g)].map((m) => m[1]);
      expect(codes.length, name).toBeGreaterThan(0);
      expect(new Set(codes), name).toEqual(new Set([code]));
    }
  });

  it("never gives a suggested child a birth year", () => {
    expect(table("records_child_suggestions")).not.toContain("birth_year");
    const add = fn("records_add_suggested_child");
    expect(add).not.toContain("birth_year");
  });
});

describe("the live migration agrees with the live rules", () => {
  beforeEach(() => {
    sql = liveSql;
  });

  /** The columns a statement sets to null: `set a = null, b = null`. */
  const nulled = (text: string) => [...text.matchAll(/([a-z_0-9]+) = null/g)].map((m) => m[1]);
  /** The columns a body tests with `[<alias>.]<column> is not null`. */
  const tested = (text: string) => [...new Set([...text.matchAll(/(?:\w+\.)?([a-z_0-9]+) is not null/g)].map((m) => m[1]))];
  const childColumns = sorted(
    [...FIELD_COLUMNS.birthday, ...FIELD_COLUMNS.grade].filter((c) => Object.keys(CHILD).includes(c)),
  );

  it("never stores the same fields", () => {
    const body = between("create function public.records_live_only_field(_field text)", "$$;");
    expect(sorted(quoted(body.slice(body.indexOf("select"))))).toEqual(sorted(LIVE_ONLY_FIELDS));
  });

  it("knows the same modes", () => {
    const column = between("add column mode text", ";");
    expect(sorted(quoted(column.slice(column.indexOf("check"))))).toEqual(sorted(RECORDS_MODES));
    const save = fn("records_save_mode");
    expect(sorted(quoted(save.slice(save.indexOf("if _mode not in ("), save.indexOf("then"))))).toEqual(sorted(RECORDS_MODES));
  });

  it("counts, and removes on the switch, the same columns each field copies", () => {
    const count = fn("records_live_copied_count");
    const save = fn("records_save_mode");
    const parts = count.split("(select count(*)").slice(1);
    const part = (marker: string) => {
      const found = parts.find((p) => p.includes(marker));
      expect(found, marker).toBeDefined();
      return found ?? "";
    };
    const statement = (start: string) => save.slice(save.indexOf(start), save.indexOf(";", save.indexOf(start)));
    const cases = [
      [FIELD_COLUMNS.birthday, part("field = 'birthday'"), statement("update public.profiles p set")],
      [FIELD_COLUMNS.grade, part("field = 'grade'"), statement("update public.family_members m set")],
      [FIELD_COLUMNS.anniversary, part("records_live_anniversary_households"), statement("update public.family_units f set anniversary")],
      [HOUSEHOLD_FIELD_COLUMNS.address, part("field = 'address'"), save.slice(save.indexOf("set address_line1"), save.indexOf("from", save.indexOf("set address_line1")))],
    ] as const;
    for (const [columns, counted, removed] of cases) {
      expect(sorted(tested(counted)), columns.join()).toEqual(sorted(columns));
      expect(sorted(nulled(removed)), columns.join()).toEqual(sorted(columns));
    }
    expect([...HOUSEHOLD_FIELD_COLUMNS.address]).toEqual([...ADDRESS_COLUMNS]);

    const suggestions = statement("update public.records_child_suggestions");
    expect(sorted(nulled(suggestions.slice(0, suggestions.indexOf("updated_at"))))).toEqual(childColumns);
    expect(sorted(tested(suggestions))).toEqual(childColumns);
  });

  it("refuses a suggested child's birthday and grade, the same columns the switch removes", () => {
    const guard = fn("records_live_child_guard");
    expect(sorted(tested(guard))).toEqual(childColumns);
  });

  it("holds the switch back for as long as a refresh's claim lasts, answering the outcomes the app reads", () => {
    const save = fn("records_save_mode");
    expect(Number(save.match(/interval '(\d+) minutes'/)?.[1]) * 60_000).toBe(LEASE_MS);
    const outcomes = [...save.matchAll(/'outcome', '([a-z]+)'/g)].map((m) => m[1]);
    expect(sorted([...new Set(outcomes)])).toEqual(sorted(SAVE_SETTING_OUTCOMES));
  });

  it("lets a member hide the same fields the directory offers to hide", () => {
    const hide = fn("records_live_hide");
    const fields = [
      ...[...hide.matchAll(/_field = '([a-z_]+)'/g)].map((m) => m[1]),
      ...[...hide.matchAll(/_field not in \(([^)]*)\)/g)].flatMap((m) => quoted(m[1])),
    ];
    expect(sorted([...new Set(fields)])).toEqual(sorted(HIDEABLE_FIELDS));
  });
});
