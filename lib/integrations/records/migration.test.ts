// The copy's field table is owned by supabase/functions/_shared/records-copy.ts
// and restated in SQL, where nothing else ties the two: a field added on one
// side only would be copied and never detached or locked, or refused.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIELD_COLUMNS,
  FIELD_TABLE,
  LOCKABLE_FIELDS,
  PROFILE_COPY_COLUMNS,
  RECORDS_FIELDS,
  VALUE_STATES,
  type ValueField,
} from "@/supabase/functions/_shared/records-copy";
import { LEASE_MS } from "@/supabase/functions/_shared/records-refresh";

const sql = readFileSync("supabase/migrations/20261209000000_church_records_copy.sql", "utf8");

const quoted = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
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

describe("the copy migration agrees with the copy rules", () => {
  it("lists the same fields to choose a setting for", () => {
    const settings = table("records_field_settings");
    expect(sorted(quoted(settings.slice(settings.indexOf("field text"), settings.indexOf("mode text"))))).toEqual(
      sorted(RECORDS_FIELDS),
    );
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
    const body = between("create function public.records_apply_copy(", "$$;");
    const written = [...body.matchAll(/when _profile \? '([a-z_]+)'/g)].map((m) => m[1]);
    expect(sorted(written)).toEqual(sorted(PROFILE_COPY_COLUMNS));
  });

  it("leaves to their own triggers the fields that aren't on the profile", () => {
    const body = between("create function public.records_profile_member_edit()", "$$;");
    const excluded = quoted(body.slice(body.indexOf("v.field not in ("), body.indexOf("loop")));
    const elsewhere = (Object.keys(FIELD_TABLE) as ValueField[]).filter((f) => FIELD_TABLE[f] !== "profile");
    expect(sorted(excluded)).toEqual(sorted(elsewhere));
  });

  it("holds a settings save back for as long as a refresh's claim lasts", () => {
    const body = between("create function public.records_save_field_settings(", "$$;");
    const minutes = Number(body.match(/interval '(\d+) minutes'/)?.[1]);
    expect(minutes * 60_000).toBe(LEASE_MS);
  });
});
