// One church's refresh from its records, run by the church admin's Refresh now
// and by the nightly refresh-church-records function. It runs with the service
// key, so every read and write here is a chain on the orgId the caller
// resolved, and the copy itself goes through records_apply_copy(), which
// checks the values it was worked out from haven't changed meanwhile.
//
// Nothing read from the records is logged: log lines carry two42's own ids and
// counts only. Free of any supabase-js import so it can be unit tested offline.
import { logError, logWarn } from "./log.ts";
import { forEachOrg, type Org } from "./orgs.ts";
import {
  type Columns,
  type CurrentValues,
  FIELD_COLUMNS,
  type FieldMode,
  LOCKABLE_FIELDS,
  planPersonCopy,
  planWrites,
  PROFILE_COPY_COLUMNS,
  RECORDS_FIELDS,
  type RecordsField,
  type StoredValue,
  type ValueField,
  type ValueRow,
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

// The row and argument shapes below restate lib/supabase/database.types.ts,
// which this offline module can't import; refresh.types.test.ts in
// lib/integrations/records holds them to it.
export interface RefreshStateRow {
  org_id: string;
  connection_id: string;
  cursor: string | null;
  last_refreshed_at: string | null;
  last_counts: Record<string, number>;
  running_since: string | null;
}

export interface PersonStateRow {
  org_id: string;
  profile_id: string;
  copied_at: string | null;
  review_reason: string | null;
  review_since: string | null;
}

export type ProfileRow = Columns & { id: string; family_id: string | null };
export type HouseholdRow = Columns & { id: string };
export type GradeRow = Columns & { id: string; claimed_profile_id: string | null };
export type FieldSettingRow = { field: string; mode: string };
export type PersonLinkRow = { profile_id: string; external_person_id: string };
export type FieldValueRow = { profile_id: string; field: string; state: string; church_value: Columns };

export type ApplyCopyArgs = {
  _org_id: string;
  _profile_id: string;
  /** The person the copy was read from, and the values it was worked out from. */
  _expected: { person: string; profile: Columns; household: Columns | null; grade: Columns | null };
  _profile: Columns;
  _household: Columns;
  _grade: Columns;
  _values: ValueRow[];
  _filled: ValueField[];
};

/** What records_apply_copy() answers; its SQL body returns exactly these. */
export const APPLY_OUTCOMES = ["applied", "held", "stale", "gone", "unlinked"] as const;
export type ApplyOutcome = (typeof APPLY_OUTCOMES)[number];

/** The narrow slice of the Supabase client this module needs. */
export interface RecordsRefreshClient {
  from(table: "records_refresh_state"): Table<RefreshStateRow>;
  from(table: "records_person_state"): Table<PersonStateRow>;
  from(table: "records_field_settings"): Table<FieldSettingRow>;
  from(table: "records_person_links"): Table<PersonLinkRow>;
  from(table: "records_field_values"): Table<FieldValueRow>;
  from(table: "profiles"): Table<ProfileRow>;
  from(table: "family_units"): Table<HouseholdRow>;
  from(table: "family_members"): Table<GradeRow>;
  rpc(fn: "records_apply_copy", args: ApplyCopyArgs): PromiseLike<{ data: ApplyOutcome | null; error: QueryError }>;
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
  /** People still to copy, because the time ran out before them or their copy failed; the next refresh carries on. */
  pending: number;
  /** People listed under Needs review. */
  review: number;
  /** Photos the records had no usable copy of. */
  photosSkipped: number;
  failed: number;
  /** Whether the run stopped at its time budget. */
  stoppedAtBudget: boolean;
}

const PAGE = 1000;
const BATCH = 50;
/** A run that died without releasing its claim stops blocking after this long; records_save_field_settings() waits out the same. */
export const LEASE_MS = 15 * 60_000;
const PHOTO_EDGE = 400;

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

const pick = (row: Columns, columns: readonly string[]): Columns =>
  Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));

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

  const release = (values: Partial<RefreshStateRow>) =>
    must(
      db
        .from("records_refresh_state")
        .update({ ...values, running_since: null })
        .eq("org_id", orgId)
        .eq("connection_id", connectionId),
      "refresh state release",
    );
  let cursor: string | null;
  try {
    cursor = await run(db, options, claimed[0].cursor, result);
  } catch (err) {
    // A failed run is not a refresh: "Last refreshed" keeps the last one that
    // finished, and the run's own error is the one that reaches the caller.
    await release({}).catch((releaseError) =>
      logError("church records refresh claim not released", releaseError, {
        route: "refresh-church-records",
        ids: { org: orgId },
      })
    );
    throw err;
  }
  // Cut short, the run hasn't finished: "Last refreshed" stays on the last
  // one that did, and the people it didn't reach are in pending.
  if (result.stoppedAtBudget) {
    await release({ cursor });
    return result;
  }
  await release({
    cursor,
    last_refreshed_at: options.now().toISOString(),
    last_counts: {
      copied: result.copied,
      pending: result.pending,
      review: result.review,
      photosSkipped: result.photosSkipped,
      failed: result.failed,
    },
  });
  return result;
}

export interface AllOrgsResult {
  /** Churches with a connection that this run refreshed. */
  connected: number;
  copied: number;
  review: number;
  pending: number;
  failed: string[];
  /** Churches whose refresh ran out of time partway. */
  cutShort: string[];
  /** Churches reached after the time was spent, left for the next run. */
  notStarted: string[];
  /** Churches whose refresh another run held, so this run skipped them. */
  busy: string[];
  /** Churches where some people's copy failed; the next run copies them again. */
  copyFailed: string[];
  /** Every church was refreshed to the end. */
  finished: boolean;
}

/**
 * Refreshes every church in turn on one shared time budget. refreshOne answers
 * null for a church with no connection. The order starts `turn` churches in,
 * so a church that uses up the time can't keep the ones after it waiting.
 */
export async function refreshAllOrgs(
  orgs: Org[],
  options: {
    elapsed: () => number;
    budgetMs: number;
    turn?: number;
    refreshOne: (org: Org) => Promise<RefreshResult | null>;
  },
): Promise<AllOrgsResult> {
  const start = orgs.length === 0 ? 0 : (((options.turn ?? 0) % orgs.length) + orgs.length) % orgs.length;
  const ordered = [...orgs.slice(start), ...orgs.slice(0, start)];
  const all: AllOrgsResult = {
    connected: 0,
    copied: 0,
    review: 0,
    pending: 0,
    failed: [],
    cutShort: [],
    notStarted: [],
    busy: [],
    copyFailed: [],
    finished: true,
  };
  const results = await forEachOrg(ordered, async (org) => {
    // A church reached after the time is spent waits for the next run rather
    // than starting reads it can't finish.
    if (options.elapsed() >= options.budgetMs) {
      all.notStarted.push(org.id);
      return { sent: 0, sendFailures: 0 };
    }
    const result = await options.refreshOne(org);
    if (!result) return { sent: 0, sendFailures: 0 };
    if (result.status === "busy") {
      all.busy.push(org.id);
      return { sent: 0, sendFailures: 0 };
    }
    all.connected++;
    all.copied += result.copied;
    all.review += result.review;
    all.pending += result.pending;
    if (result.stoppedAtBudget) all.cutShort.push(org.id);
    if (result.failed > 0) all.copyFailed.push(org.id);
    return { sent: result.copied, sendFailures: result.failed };
  });
  all.failed = results.filter((r) => r.error).map((r) => r.orgId);
  all.finished =
    all.failed.length + all.cutShort.length + all.notStarted.length + all.busy.length + all.copyFailed.length === 0;
  return all;
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
  const reviewed: Pick<PersonStateRow, "profile_id" | "review_reason" | "review_since">[] = [];
  const now = options.now().toISOString();
  for (const link of links) {
    const status = presence.get(link.external_person_id);
    const reason = status === undefined ? "missing" : status === "inactive" ? "inactive" : null;
    const state = states.get(link.profile_id);
    if (reason) result.review++;
    if ((state?.review_reason ?? null) === reason) continue;
    reviewed.push({ profile_id: link.profile_id, review_reason: reason, review_since: reason ? now : null });
  }
  for (let i = 0; i < reviewed.length; i += PAGE) {
    await must(
      db
        .from("records_person_state")
        .upsert(reviewed.slice(i, i + PAGE).map((row) => ({ ...row, org_id: orgId })), { onConflict: "org_id,profile_id" }),
      "review write",
    );
  }

  const changes = await source.changedSince(creds, cursor);
  if (settings.size === 0) return changes.cursor;

  const changed = new Set(changes.ids);
  const uncopied = (link: { profile_id: string }) => !states.get(link.profile_id)?.copied_at;
  const due = links.filter((link) => {
    if (presence.get(link.external_person_id) !== "active") return false;
    return uncopied(link) || changed.has(link.external_person_id);
  });
  // The mark is inclusive, so people copied already can come back every run;
  // whoever is still waiting goes first, or the same ones could use the time each night.
  due.sort((a, b) => Number(uncopied(b)) - Number(uncopied(a)));
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

  // Whoever the time ran out before is marked to be copied in full next time,
  // like a failed copy, so the next run starts where this one stopped.
  const unreached = due.slice(done).map((link) => link.profile_id);
  result.pending = unreached.length + retry.length;
  const marked = [...retry, ...unreached];
  for (let i = 0; i < marked.length; i += PAGE) {
    await must(
      db.from("records_person_state").upsert(
        marked.slice(i, i + PAGE).map((profileId) => ({ org_id: orgId, profile_id: profileId, copied_at: null })),
        { onConflict: "org_id,profile_id" },
      ),
      "retry mark",
    );
  }
  // Everyone changed since the mark was handled, or marked to be copied in
  // full next time, so the mark can move on.
  return changes.cursor;
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
                .select(["id", ...FIELD_COLUMNS.anniversary].join(", "))
                .eq("org_id", orgId)
                .in("id", familyIds)
                .order("id"),
            "households",
          )
        ).map((row) => [row.id, row]),
  );
  // The lowest id is the person's grade row, as records_apply_copy() picks it.
  const grades = new Map<string, GradeRow>();
  for (const row of await allRows(
    () =>
      db
        .from("family_members")
        .select(["id", "claimed_profile_id", ...FIELD_COLUMNS.grade].join(", "))
        .eq("org_id", orgId)
        .in("claimed_profile_id", profileIds)
        .order("id"),
    "household members",
  )) {
    if (row.claimed_profile_id && !grades.has(row.claimed_profile_id)) grades.set(row.claimed_profile_id, row);
  }
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
      profile: pick(profile, PROFILE_COPY_COLUMNS),
      household: household && pick(household, FIELD_COLUMNS.anniversary),
      grade: grade && pick(grade, FIELD_COLUMNS.grade),
    };
    try {
      const outcome = await copyPerson(db, options, settings, link.profile_id, person, current, stored.get(link.profile_id));
      if (outcome.copied) result.copied++;
      if (outcome.photoSkipped) result.photosSkipped++;
      if (outcome.stale) retry.push(link.profile_id);
      // A spouse later in the batch checks the household's anniversary against
      // what the database holds now, not the batch's first read.
      const familyId = profile.family_id;
      if (outcome.householdWritten && familyId) {
        const [row] = await allRows(
          () =>
            db
              .from("family_units")
              .select(["id", ...FIELD_COLUMNS.anniversary].join(", "))
              .eq("org_id", orgId)
              .eq("id", familyId)
              .order("id"),
          "household",
        );
        if (row) households.set(row.id, row);
        else households.delete(familyId);
      }
    } catch (err) {
      result.failed++;
      retry.push(link.profile_id);
      logError("church records copy failed for a person", err, {
        route: "refresh-church-records",
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
): Promise<{ copied: boolean; photoSkipped: boolean; stale: boolean; householdWritten: boolean }> {
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
    _expected: { person: person.id, profile: current.profile, household: current.household, grade: current.grade },
    _profile: plan.profile,
    _household: plan.household,
    _grade: plan.grade,
    _values: plan.values,
    _filled: plan.filled,
  });
  if (error) throw new Error(`apply failed: ${error.message}`);
  if (data === "stale") {
    logWarn("church records copy skipped a person edited meanwhile", undefined, {
      route: "refresh-church-records",
      ids: { org: orgId, profile: profileId },
    });
    return { copied: false, photoSkipped, stale: true, householdWritten: false };
  }
  // "held": the anniversary was left out because another linked person in the
  // household holds a different one; everything else landed.
  const written = data === "held" ? { ...plan, household: {} } : plan;
  return {
    copied: (data === "applied" || data === "held") && planWrites(written),
    photoSkipped,
    stale: false,
    householdWritten: data === "applied" && Object.keys(plan.household).length > 0,
  };
}
