// One church's refresh from its records, run by the church admin's Refresh now
// and by the nightly refresh-church-records function. It runs with the service
// key, so every read and write here is a chain on the orgId the caller
// resolved, and the copy itself goes through records_apply_copy(), which
// checks the values it was worked out from haven't changed meanwhile.
//
// Nothing read from the records is logged: log lines carry two42's own ids and
// counts only. Free of any supabase-js import so it can be unit tested offline.
import { logError, logWarn } from "./log.ts";
import {
  type Columns,
  type CurrentValues,
  type FieldMode,
  LOCKABLE_FIELDS,
  planPersonCopy,
  planWrites,
  PROFILE_COPY_COLUMNS,
  RECORDS_FIELDS,
  type RecordsField,
  type StoredValue,
  type ValueField,
  type ValueState,
} from "./records-copy.ts";
import type { RecordsCopyPerson, RecordsCopySource, RecordsCredentials } from "./records-types.ts";

type QueryError = { message: string; code?: string } | null;

interface Rows<T> extends PromiseLike<{ data: T[] | null; error: QueryError }> {
  eq(column: string, value: unknown): Rows<T>;
  in(column: string, values: readonly unknown[]): Rows<T>;
  or(filters: string): Rows<T>;
  order(column: string): Rows<T>;
  range(from: number, to: number): Rows<T>;
}

interface Write<T> extends PromiseLike<{ error: QueryError }> {
  eq(column: string, value: unknown): Write<T>;
  or(filters: string): Write<T>;
  select(columns: string): Rows<T>;
}

interface Table<T> {
  select(columns: string): Rows<T>;
  update(values: Partial<T>): Write<T>;
  upsert(values: Partial<T> | Partial<T>[], options: { onConflict: string; ignoreDuplicates?: boolean }): Write<T>;
}

interface RefreshStateRow {
  org_id: string;
  connection_id: string;
  cursor: string | null;
  last_refreshed_at: string | null;
  last_counts: Record<string, number>;
  running_since: string | null;
}

interface PersonStateRow {
  org_id: string;
  profile_id: string;
  copied_at: string | null;
  review_reason: "inactive" | "missing" | null;
  review_since: string | null;
}

type ProfileRow = Columns & { id: string; family_id: string | null };

/** The narrow slice of the Supabase client this module needs. */
export interface RecordsRefreshClient {
  from(table: "records_refresh_state"): Table<RefreshStateRow>;
  from(table: "records_person_state"): Table<PersonStateRow>;
  from(table: "records_field_settings"): Table<{ field: string; mode: string }>;
  from(table: "records_person_links"): Table<{ profile_id: string; external_person_id: string }>;
  from(table: "records_field_values"): Table<{ profile_id: string; field: string; state: string; church_value: Columns }>;
  from(table: "profiles"): Table<ProfileRow>;
  from(table: "family_units"): Table<Columns & { id: string }>;
  from(table: "family_members"): Table<Columns & { id: string; claimed_profile_id: string }>;
  rpc(
    fn: "records_apply_copy",
    args: {
      _org_id: string;
      _profile_id: string;
      _expected: Record<string, Columns | null>;
      _profile: Columns;
      _household: Columns;
      _grade: Columns;
      _values: unknown[];
      _filled: boolean;
    },
  ): PromiseLike<{ data: string | null; error: QueryError }>;
}

export interface RefreshOptions {
  orgId: string;
  connectionId: string;
  creds: RecordsCredentials;
  source: RecordsCopySource;
  normalizePhone: (raw: string) => string | null;
  /** Stores a downloaded photo for the person in two42's own storage and returns its address. */
  storePhoto: (orgId: string, profileId: string, bytes: Uint8Array) => Promise<string>;
  now: () => Date;
  elapsed: () => number;
  budgetMs: number;
}

export interface RefreshResult {
  status: "done" | "busy";
  /** People whose details changed in two42. */
  copied: number;
  /** People still waiting for their first copy, because the time ran out or a copy failed. */
  pending: number;
  /** People listed under Needs review. */
  review: number;
  /** Photos the records wouldn't give. */
  photosSkipped: number;
  failed: number;
  /** Whether the run stopped at its time budget. */
  stoppedAtBudget: boolean;
}

const PAGE = 1000;
const BATCH = 50;
// A run that died without releasing its claim stops blocking after this long.
const LEASE_MS = 15 * 60_000;
const PHOTO_EDGE = 400;
const ROUTE = "refresh-church-records";

async function allRows<T>(query: () => Rows<T>, what: string): Promise<T[]> {
  const found: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1);
    if (error) throw new Error(`${what} read failed: ${error.message}`);
    found.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return found;
  }
}

async function must(result: PromiseLike<{ error: QueryError }>, what: string) {
  const { error } = await result;
  if (error) throw new Error(`${what} failed: ${error.message}`);
}

function parseSettings(rows: { field: string; mode: string }[]): Map<RecordsField, FieldMode> {
  const settings = new Map<RecordsField, FieldMode>();
  for (const { field, mode } of rows) {
    if (!(RECORDS_FIELDS as readonly string[]).includes(field)) continue;
    const f = field as RecordsField;
    if (mode === "locked" && LOCKABLE_FIELDS.includes(f)) settings.set(f, "locked");
    else if (mode === "member") settings.set(f, "member");
  }
  return settings;
}

export async function refreshOrg(db: RecordsRefreshClient, options: RefreshOptions): Promise<RefreshResult> {
  const { orgId, connectionId } = options;
  const result: RefreshResult = {
    status: "done",
    copied: 0,
    pending: 0,
    review: 0,
    photosSkipped: 0,
    failed: 0,
    stoppedAtBudget: false,
  };

  await must(
    db
      .from("records_refresh_state")
      .upsert({ org_id: orgId, connection_id: connectionId }, { onConflict: "org_id", ignoreDuplicates: true }),
    "refresh state insert",
  );
  const stale = new Date(options.now().getTime() - LEASE_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("records_refresh_state")
    .update({ running_since: options.now().toISOString() })
    .eq("org_id", orgId)
    .eq("connection_id", connectionId)
    .or(`running_since.is.null,running_since.lt."${stale}"`)
    .select("cursor");
  if (claimError) throw new Error(`refresh claim failed: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return { ...result, status: "busy" };

  let cursor = claimed[0].cursor;
  try {
    cursor = await run(db, options, claimed[0].cursor, result);
  } finally {
    await must(
      db
        .from("records_refresh_state")
        .update({
          cursor,
          running_since: null,
          last_refreshed_at: options.now().toISOString(),
          last_counts: {
            copied: result.copied,
            pending: result.pending,
            review: result.review,
            photosSkipped: result.photosSkipped,
            failed: result.failed,
          },
        })
        .eq("org_id", orgId)
        .eq("connection_id", connectionId),
      "refresh state release",
    );
  }
  return result;
}

/** Runs the refresh and returns the mark to keep for next time. */
async function run(
  db: RecordsRefreshClient,
  options: RefreshOptions,
  cursor: string | null,
  result: RefreshResult,
): Promise<string | null> {
  const { orgId, connectionId, creds, source } = options;
  const settings = parseSettings(
    await allRows(() => db.from("records_field_settings").select("field, mode").eq("org_id", orgId).order("field"), "settings"),
  );
  const links = await allRows(
    () =>
      db
        .from("records_person_links")
        .select("profile_id, external_person_id")
        .eq("org_id", orgId)
        .eq("connection_id", connectionId)
        .order("profile_id"),
    "links",
  );
  const states = new Map(
    (
      await allRows(
        () =>
          db
            .from("records_person_state")
            .select("profile_id, copied_at, review_reason, review_since")
            .eq("org_id", orgId)
            .order("profile_id"),
        "person state",
      )
    ).map((row) => [row.profile_id, row]),
  );

  // Needs review: every link's existence and status, read by id. A person
  // merged or deleted in the records leaves no change to find, so this can't
  // wait for one. Nothing else happens to them.
  const presence = await source.presence(creds, links.map((l) => l.external_person_id));
  const reviewed: Partial<PersonStateRow>[] = [];
  const now = options.now().toISOString();
  for (const link of links) {
    const status = presence.get(link.external_person_id);
    const reason = status === undefined ? "missing" : status === "inactive" ? "inactive" : null;
    const state = states.get(link.profile_id);
    if (reason) result.review++;
    if ((state?.review_reason ?? null) === reason) continue;
    reviewed.push({ org_id: orgId, profile_id: link.profile_id, review_reason: reason, review_since: reason ? now : null });
  }
  for (let i = 0; i < reviewed.length; i += PAGE) {
    await must(
      db.from("records_person_state").upsert(reviewed.slice(i, i + PAGE), { onConflict: "org_id,profile_id" }),
      "review write",
    );
  }

  const changes = await source.changedSince(creds, cursor);
  if (settings.size === 0) return changes.cursor;

  const changed = new Set(changes.ids);
  const due = links.filter((link) => {
    if (presence.get(link.external_person_id) !== "active") return false;
    return !states.get(link.profile_id)?.copied_at || changed.has(link.external_person_id);
  });
  const retry: string[] = [];
  let done = 0;
  for (let i = 0; i < due.length; i += BATCH) {
    if (options.elapsed() >= options.budgetMs) {
      result.stoppedAtBudget = true;
      break;
    }
    const batch = due.slice(i, i + BATCH);
    done += await copyBatch(db, options, settings, batch, retry, result);
    if (done < i + batch.length) {
      result.stoppedAtBudget = true;
      break;
    }
  }

  if (retry.length > 0) {
    await must(
      db.from("records_person_state").upsert(
        retry.map((profileId) => ({ org_id: orgId, profile_id: profileId, copied_at: null })),
        { onConflict: "org_id,profile_id" },
      ),
      "retry mark",
    );
  }
  const copiedNow = new Set(due.slice(0, done).map((l) => l.profile_id).filter((id) => !retry.includes(id)));
  result.pending = links.filter(
    (link) =>
      presence.get(link.external_person_id) === "active" &&
      !copiedNow.has(link.profile_id) &&
      (!states.get(link.profile_id)?.copied_at || retry.includes(link.profile_id)),
  ).length;
  // Everyone changed since the mark was handled, or marked to be copied in
  // full next time, so the mark can move on; cut short, it stays.
  return result.stoppedAtBudget ? cursor : changes.cursor;
}

/** Copies one batch, returning how many of its people were handled before the time ran out. */
async function copyBatch(
  db: RecordsRefreshClient,
  options: RefreshOptions,
  settings: Map<RecordsField, FieldMode>,
  batch: { profile_id: string; external_person_id: string }[],
  retry: string[],
  result: RefreshResult,
): Promise<number> {
  const { orgId, creds, source } = options;
  const profileIds = batch.map((l) => l.profile_id);
  const people = new Map<string, RecordsCopyPerson>(
    (await source.peopleForCopy(creds, batch.map((l) => l.external_person_id))).map((p) => [p.id, p]),
  );

  const profiles = new Map(
    (
      await allRows(
        () =>
          db
            .from("profiles")
            .select(["id", "family_id", ...PROFILE_COPY_COLUMNS].join(", "))
            .eq("org_id", orgId)
            .in("id", profileIds)
            .order("id"),
        "profiles",
      )
    ).map((row) => [row.id, row]),
  );
  const familyIds = [...new Set([...profiles.values()].map((p) => p.family_id).filter((id): id is string => !!id))];
  const households = new Map(
    familyIds.length === 0
      ? []
      : (
          await allRows(
            () =>
              db
                .from("family_units")
                .select("id, anniversary_month, anniversary_day, anniversary_year")
                .eq("org_id", orgId)
                .in("id", familyIds)
                .order("id"),
            "households",
          )
        ).map((row) => [row.id, row]),
  );
  const grades = new Map(
    (
      await allRows(
        () =>
          db
            .from("family_members")
            .select("id, claimed_profile_id, graduation_year")
            .eq("org_id", orgId)
            .in("claimed_profile_id", profileIds)
            .order("id"),
        "household members",
      )
    ).map((row) => [row.claimed_profile_id, row]),
  );
  const stored = new Map<string, Map<ValueField, StoredValue>>();
  for (const row of await allRows(
    () =>
      db
        .from("records_field_values")
        .select("profile_id, field, state, church_value")
        .eq("org_id", orgId)
        .in("profile_id", profileIds)
        .order("profile_id"),
    "values",
  )) {
    const forPerson = stored.get(row.profile_id) ?? new Map<ValueField, StoredValue>();
    forPerson.set(row.field as ValueField, { state: row.state as ValueState, churchValue: row.church_value });
    stored.set(row.profile_id, forPerson);
  }

  let handled = 0;
  for (const link of batch) {
    if (options.elapsed() >= options.budgetMs) return handled;
    handled++;
    const person = people.get(link.external_person_id);
    const profile = profiles.get(link.profile_id);
    // Gone or inactive since the presence read; the next run lists them for review.
    if (!person || !profile) continue;
    const household = profile.family_id ? households.get(profile.family_id) ?? null : null;
    const grade = grades.get(link.profile_id) ?? null;
    const current: CurrentValues = {
      profile: Object.fromEntries(PROFILE_COPY_COLUMNS.map((c) => [c, profile[c] ?? null])),
      household: household && {
        anniversary_month: household.anniversary_month ?? null,
        anniversary_day: household.anniversary_day ?? null,
        anniversary_year: household.anniversary_year ?? null,
      },
      grade: grade && { graduation_year: grade.graduation_year ?? null },
    };
    try {
      const outcome = await copyPerson(db, options, settings, link.profile_id, person, current, stored.get(link.profile_id));
      if (outcome.copied) result.copied++;
      if (outcome.photoSkipped) result.photosSkipped++;
      if (outcome.stale) retry.push(link.profile_id);
    } catch (err) {
      result.failed++;
      retry.push(link.profile_id);
      logError("church records copy failed for a person", err, {
        route: ROUTE,
        ids: { org: orgId, profile: link.profile_id },
      });
    }
  }
  return handled;
}

async function copyPerson(
  db: RecordsRefreshClient,
  options: RefreshOptions,
  settings: Map<RecordsField, FieldMode>,
  profileId: string,
  person: RecordsCopyPerson,
  current: CurrentValues,
  stored: Map<ValueField, StoredValue> | undefined,
): Promise<{ copied: boolean; photoSkipped: boolean; stale: boolean }> {
  const { orgId } = options;
  const input = {
    settings,
    current,
    stored: stored ?? new Map(),
    person,
    normalizePhone: options.normalizePhone,
    today: options.now(),
  };
  let plan = planPersonCopy(input);
  let photoSkipped = false;
  if (plan.photoWanted) {
    const token = plan.photoWanted;
    const bytes = await options.source.photo(options.creds, token, PHOTO_EDGE);
    if (bytes) {
      plan = planPersonCopy({ ...input, storedPhoto: { token, url: await options.storePhoto(orgId, profileId, bytes) } });
    } else {
      photoSkipped = true;
    }
  }
  const { data, error } = await db.rpc("records_apply_copy", {
    _org_id: orgId,
    _profile_id: profileId,
    _expected: { profile: current.profile, household: current.household, grade: current.grade },
    _profile: plan.profile,
    _household: plan.household,
    _grade: plan.grade,
    _values: plan.values,
    _filled: plan.filled,
  });
  if (error) throw new Error(`apply failed: ${error.message}`);
  if (data === "stale") {
    logWarn("church records copy skipped a person edited meanwhile", undefined, {
      route: ROUTE,
      ids: { org: orgId, profile: profileId },
    });
    return { copied: false, photoSkipped, stale: true };
  }
  return { copied: data === "applied" && planWrites(plan), photoSkipped, stale: false };
}
