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
  type RecordsMode,
  type StoredValue,
  storedFields,
  storedIn,
  storedRecordsMode,
  type ValueField,
  type ValueRow,
  type ValueState,
} from "./records-copy.ts";
import { RecordsError } from "./records-errors.ts";
import {
  childSuggestionRows,
  HOUSEHOLD_COPY_COLUMNS,
  HOUSEHOLD_FIELDS,
  type HouseholdField,
  householdPlanChanges,
  type HouseholdStoredValue,
  type HouseholdSuggestion,
  type HouseholdValueRow,
  type PlanProfile,
  planHouseholdCopy,
  planHouseholdSuggestions,
} from "./records-households.ts";
import type { RecordsCopyPerson, RecordsCopySource, RecordsCredentials, RecordsFamily } from "./records-types.ts";

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
  is(column: string, value: null): Write<T>;
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
export type OrgSettingsRow = { suggest_children: boolean; mode: string };
export type HouseholdLinkRow = { family_id: string; external_family_id: string };
export type HouseholdValueDbRow = { family_id: string; field: string; state: string; church_value: Columns };
export type ChildSuggestionRow = { id: string; family_member_id: string | null; photo: string | null };
export type HouseholdMemberRow = Columns & {
  id: string;
  family_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

export type ReplaceSuggestionsArgs = {
  _org_id: string;
  _connection_id: string;
  _suggestions: HouseholdSuggestion[];
};

export type ApplyHouseholdCopyArgs = {
  _org_id: string;
  _connection_id: string;
  _family_id: string;
  /** The family the copy was read from, the household's columns and each field's state as read. */
  _expected: { family: string; household: Columns; states: Record<string, ValueState | null> };
  _household: Columns;
  _values: HouseholdValueRow[];
};

export type SyncChildrenArgs = {
  _org_id: string;
  _connection_id: string;
  _family_id: string;
  _external_family_id: string;
  _children: ReturnType<typeof childSuggestionRows>;
};

/** What records_apply_household_copy() answers; its SQL body returns exactly these. */
export const APPLY_HOUSEHOLD_OUTCOMES = ["applied", "stale", "gone", "unlinked"] as const;
export type ApplyHouseholdOutcome = (typeof APPLY_HOUSEHOLD_OUTCOMES)[number];

export type ApplyCopyArgs = {
  _org_id: string;
  _profile_id: string;
  /** The person the copy was read from, and the values it was worked out from. */
  _expected: {
    person: string;
    profile: Columns;
    household: Columns | null;
    grade: Columns | null;
    /** Each copied field's state as read, null where it had none. */
    states: Record<string, ValueState | null>;
  };
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
  from(table: "family_members"): Table<GradeRow & HouseholdMemberRow>;
  from(table: "records_org_settings"): Table<OrgSettingsRow>;
  from(table: "records_household_links"): Table<HouseholdLinkRow>;
  from(table: "records_household_values"): Table<HouseholdValueDbRow>;
  from(table: "records_child_suggestions"): Table<ChildSuggestionRow>;
  rpc(fn: "records_apply_copy", args: ApplyCopyArgs): PromiseLike<{ data: ApplyOutcome | null; error: QueryError }>;
  rpc(
    fn: "records_replace_household_suggestions",
    args: ReplaceSuggestionsArgs,
  ): PromiseLike<{ data: number | null; error: QueryError }>;
  rpc(
    fn: "records_apply_household_copy",
    args: ApplyHouseholdCopyArgs,
  ): PromiseLike<{ data: ApplyHouseholdOutcome | null; error: QueryError }>;
  rpc(fn: "records_sync_child_suggestions", args: SyncChildrenArgs): PromiseLike<{ data: number | null; error: QueryError }>;
}

export interface RefreshOptions {
  orgId: string;
  connectionId: string;
  creds: RecordsCredentials;
  source: RecordsCopySource;
  normalizePhone: (raw: string) => string | null;
  /** Stores a downloaded photo for the person in two42's own storage and returns its address. */
  storePhoto: (orgId: string, profileId: string, bytes: Uint8Array) => Promise<string>;
  /** Removes that stored photo; used when the person was deleted while their copy ran. */
  removePhoto: (orgId: string, profileId: string) => Promise<void>;
  /** Stores a downloaded photo for a child added to a household and returns its address. */
  storeChildPhoto: (orgId: string, familyMemberId: string, bytes: Uint8Array) => Promise<string>;
  /** Removes that stored photo; used when the household gave the child a photo of its own meanwhile. */
  removeChildPhoto: (orgId: string, familyMemberId: string) => Promise<void>;
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
  /** Linked households whose address or home phone changed in two42. */
  householdsCopied: number;
  /** The records refused the family reads, so households weren't refreshed; people were. */
  householdsUnavailable: boolean;
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

/**
 * Upserts person state rows. An admin can unlink someone while a refresh runs,
 * and that person's row then fails the link foreign key and would fail the
 * whole write, so a page that does is written again without the unlinked people.
 */
async function writeStates(
  db: RecordsRefreshClient,
  orgId: string,
  rows: Partial<PersonStateRow>[],
  what: string,
) {
  for (let i = 0; i < rows.length; i += PAGE) {
    let page = rows.slice(i, i + PAGE);
    let { error } = await db
      .from("records_person_state")
      .upsert(page.map((row) => ({ ...row, org_id: orgId })), { onConflict: "org_id,profile_id" });
    if (error?.code === "23503") {
      const linked = new Set(
        (
          await allRows(
            () => db.from("records_person_links").select("profile_id").eq("org_id", orgId).order("profile_id"),
            "links",
          )
        ).map((link) => link.profile_id),
      );
      page = page.filter((row) => row.profile_id !== undefined && linked.has(row.profile_id));
      ({ error } = page.length
        ? await db
          .from("records_person_state")
          .upsert(page.map((row) => ({ ...row, org_id: orgId })), { onConflict: "org_id,profile_id" })
        : { error: null });
    }
    if (error) throw new Error(`${what} failed: ${error.message}`);
  }
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
    householdsCopied: 0,
    householdsUnavailable: false,
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
  let cursor: string | null | undefined;
  try {
    // Read inside the claim: records_save_mode() and records_save_children_setting() refuse while it is held.
    const [orgSettings] = await allRows(
      () => db.from("records_org_settings").select("suggest_children, mode").eq("org_id", orgId).order("org_id"),
      "records settings",
    );
    const church: ChurchSettings = {
      mode: storedRecordsMode(orgSettings?.mode),
      suggestChildren: orgSettings?.suggest_children === true,
    };
    cursor = await run(db, options, claimed[0].cursor, result, church.mode);
    await householdStep(db, options, result, church);
  } catch (err) {
    // A failed run is not a refresh: "Last refreshed" keeps the last one that
    // finished, and the run's own error is the one that reaches the caller.
    // People copied before households failed keep their mark, so they aren't read again.
    await release(cursor === undefined ? {} : { cursor }).catch((releaseError) =>
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
      householdsCopied: result.householdsCopied,
      householdsUnavailable: result.householdsUnavailable ? 1 : 0,
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

interface ChurchSettings {
  mode: RecordsMode;
  suggestChildren: boolean;
}

/** Runs the refresh and returns the mark to keep for next time. */
async function run(
  db: RecordsRefreshClient,
  options: RefreshOptions,
  cursor: string | null,
  result: RefreshResult,
  mode: RecordsMode,
): Promise<string | null> {
  const { orgId, connectionId, creds, source } = options;
  const settings = storedFields(
    parseSettings(
      await allRows(() => db.from("records_field_settings").select("field, mode").eq("org_id", orgId).order("field"), "settings"),
    ),
    mode,
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
  await writeStates(db, orgId, reviewed, "review write");

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
  await writeStates(
    db,
    orgId,
    marked.map((profileId) => ({ profile_id: profileId, copied_at: null })),
    "retry mark",
  );
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
  let photoStored = false;
  if (plan.photoWanted) {
    const token = plan.photoWanted;
    const bytes = await options.source.photo(options.creds, token, PHOTO_EDGE);
    if (bytes) {
      plan = planPersonCopy({ ...input, storedPhoto: { token, url: await options.storePhoto(orgId, profileId, bytes) } });
      photoStored = true;
    } else {
      photoSkipped = true;
    }
  }
  const { data, error } = await db.rpc("records_apply_copy", {
    _org_id: orgId,
    _profile_id: profileId,
    _expected: {
      person: person.id,
      profile: current.profile,
      household: current.household,
      grade: current.grade,
      // The planner copies preferred_name along with name, and it has a state of its own.
      states: Object.fromEntries(
        [...settings.keys(), ...(settings.has("name") ? ["preferred_name"] : [])].map((field) => [
          field,
          stored?.get(field as ValueField)?.state ?? null,
        ]),
      ),
    },
    _profile: plan.profile,
    _household: plan.household,
    _grade: plan.grade,
    _values: plan.values,
    _filled: plan.filled,
  });
  if (error) throw new Error(`apply failed: ${error.message}`);
  // delete_person() removed only the objects there when it ran, so a photo
  // stored for someone deleted meanwhile would outlive them.
  if (data === "gone" && photoStored) {
    await options.removePhoto(orgId, profileId).catch((err) =>
      logError("church records copy couldn't remove a deleted person's photo", err, {
        route: "refresh-church-records",
        ids: { org: orgId, profile: profileId },
      })
    );
  }
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

const IDS_PER_READ = 100;
const FAMILIES_PER_READ = 50;

async function rowsByIds<T>(ids: readonly string[], read: (chunk: string[]) => Rows<T>, what: string): Promise<T[]> {
  const found: T[] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const chunk = ids.slice(i, i + IDS_PER_READ);
    found.push(...(await allRows(() => read(chunk), what)));
  }
  return found;
}

const PLAN_PROFILE_COLUMNS = "id, family_id, relationship, role, first_name, last_name";
const asPlanProfile = (row: ProfileRow) => row as unknown as PlanProfile;

/**
 * The church's families: household suggestions, the address and home phone of
 * households linked to their family, and suggested children. Runs inside the
 * refresh's claim. The records refusing a family read ends this step only, so
 * a key made before families were read keeps copying people.
 */
async function householdStep(
  db: RecordsRefreshClient,
  options: RefreshOptions,
  result: RefreshResult,
  church: ChurchSettings,
) {
  const source = options.source.households;
  if (!source) return;
  if (options.elapsed() >= options.budgetMs) {
    result.stoppedAtBudget = true;
    return;
  }
  const { orgId, connectionId, creds } = options;

  const { suggestChildren } = church;
  const fields = new Set(
    (await allRows(() => db.from("records_field_settings").select("field, mode").eq("org_id", orgId).order("field"), "settings"))
      .filter((row) => (HOUSEHOLD_FIELDS as readonly string[]).includes(row.field) && row.mode === "member")
      .filter((row) => storedIn(church.mode, row.field))
      .map((row) => row.field as HouseholdField),
  );
  const personLinks = await allRows(
    () =>
      db
        .from("records_person_links")
        .select("profile_id, external_person_id")
        .eq("org_id", orgId)
        .eq("connection_id", connectionId)
        .order("profile_id"),
    "links",
  );
  const householdLinks = await allRows(
    () =>
      db
        .from("records_household_links")
        .select("family_id, external_family_id")
        .eq("org_id", orgId)
        .eq("connection_id", connectionId)
        .order("family_id"),
    "household links",
  );

  let familyOf: Map<string, string>;
  const families: RecordsFamily[] = [];
  try {
    familyOf = await source.familyOf(creds, personLinks.map((l) => l.external_person_id));
    const familyIds = [...new Set([...familyOf.values(), ...householdLinks.map((l) => l.external_family_id)])].sort();
    for (let i = 0; i < familyIds.length; i += FAMILIES_PER_READ) {
      // Suggestions are only replaced from every family, so the last ones stay.
      if (options.elapsed() >= options.budgetMs) {
        result.stoppedAtBudget = true;
        return;
      }
      families.push(...(await source.families(creds, familyIds.slice(i, i + FAMILIES_PER_READ), { children: suggestChildren })));
    }
  } catch (err) {
    // Only a refused read is the key's role; anything else fails the run like any records error.
    if (!(err instanceof RecordsError) || err.kind !== "unauthorized") throw err;
    result.householdsUnavailable = true;
    logWarn("church records refresh couldn't read families", err, {
      route: "refresh-church-records",
      ids: { org: orgId },
    });
    return;
  }
  const familyById = new Map(families.map((f) => [f.id, f]));

  const linkedProfiles = await rowsByIds(
    personLinks.map((l) => l.profile_id),
    (chunk) => db.from("profiles").select(PLAN_PROFILE_COLUMNS).eq("org_id", orgId).in("id", chunk).order("id"),
    "profiles",
  );
  const householdIds = [
    ...new Set([
      ...linkedProfiles.map((p) => p.family_id).filter((id): id is string => !!id),
      ...householdLinks.map((l) => l.family_id),
    ]),
  ];
  const profiles = new Map<string, PlanProfile>(linkedProfiles.map((p) => [p.id, asPlanProfile(p)]));
  for (const row of await rowsByIds(
    householdIds,
    (chunk) => db.from("profiles").select(PLAN_PROFILE_COLUMNS).eq("org_id", orgId).in("family_id", chunk).order("id"),
    "household profiles",
  )) profiles.set(row.id, asPlanProfile(row));
  const households = new Map(
    (
      await rowsByIds(
        householdIds,
        (chunk) =>
          db
            .from("family_units")
            .select(["id", "created_at", ...HOUSEHOLD_COPY_COLUMNS].join(", "))
            .eq("org_id", orgId)
            .in("id", chunk)
            .order("id"),
        "households",
      )
    ).map((row) => [row.id, row]),
  );

  const suggestions = planHouseholdSuggestions({
    families,
    familyOf,
    links: new Map(personLinks.map((l) => [l.external_person_id, l.profile_id])),
    profiles,
    households: new Map([...households.values()].map((h) => [h.id, { id: h.id, created_at: String(h.created_at) }])),
    householdLinks: new Map(householdLinks.map((l) => [l.family_id, l.external_family_id])),
  });
  const { error } = await db.rpc("records_replace_household_suggestions", {
    _org_id: orgId,
    _connection_id: connectionId,
    _suggestions: suggestions,
  });
  if (error) throw new Error(`household suggestions write failed: ${error.message}`);

  const linked = householdLinks.filter((l) => familyById.has(l.external_family_id) && households.has(l.family_id));
  const linkedIds = linked.map((l) => l.family_id);
  const stored = new Map<string, Map<HouseholdField, HouseholdStoredValue>>();
  for (const row of await rowsByIds(
    linkedIds,
    (chunk) =>
      db
        .from("records_household_values")
        .select("family_id, field, state, church_value")
        .eq("org_id", orgId)
        .in("family_id", chunk)
        .order("family_id"),
    "household values",
  )) {
    const forHousehold = stored.get(row.family_id) ?? new Map<HouseholdField, HouseholdStoredValue>();
    forHousehold.set(row.field as HouseholdField, { state: row.state as ValueState, churchValue: row.church_value });
    stored.set(row.family_id, forHousehold);
  }
  const entries = suggestChildren
    ? await rowsByIds(
      linkedIds,
      (chunk) =>
        db.from("family_members").select("id, family_id, first_name, last_name").eq("org_id", orgId).in("family_id", chunk)
          .eq("relationship", "child").order("id"),
      "household members",
    )
    : [];
  // An entry another suggestion was added as is that child, so it can't stand in for a same-named sibling.
  const claimed = new Set(
    suggestChildren
      ? (await rowsByIds(
        linkedIds,
        (chunk) =>
          db.from("records_child_suggestions").select("id, family_member_id").eq("org_id", orgId).in("family_id", chunk)
            .eq("state", "added").order("id"),
        "added children",
      )).map((r) => r.family_member_id).filter((id) => id !== null)
      : [],
  );
  const linkedPeople = new Set(personLinks.map((l) => l.external_person_id));

  for (const link of linked) {
    if (options.elapsed() >= options.budgetMs) {
      result.stoppedAtBudget = true;
      return;
    }
    const family = familyById.get(link.external_family_id)!;
    const current = households.get(link.family_id)!;
    const prior = stored.get(link.family_id) ?? new Map<HouseholdField, HouseholdStoredValue>();
    const plan = planHouseholdCopy({ fields, current, stored: prior, family, normalizePhone: options.normalizePhone });
    if (householdPlanChanges(plan, prior)) {
      const { data, error } = await db.rpc("records_apply_household_copy", {
        _org_id: orgId,
        _connection_id: connectionId,
        _family_id: link.family_id,
        _expected: {
          family: link.external_family_id,
          household: pick(current, HOUSEHOLD_COPY_COLUMNS),
          states: Object.fromEntries([...fields].map((field) => [field, prior.get(field)?.state ?? null])),
        },
        _household: plan.household,
        _values: plan.values,
      });
      if (error) throw new Error(`household apply failed: ${error.message}`);
      if (data === "applied" && Object.keys(plan.household).length > 0) result.householdsCopied++;
      if (data === "stale") {
        logWarn("church records copy skipped a household edited meanwhile", undefined, {
          route: "refresh-church-records",
          ids: { org: orgId, household: link.family_id },
        });
      }
    }
    if (suggestChildren) {
      const { error } = await db.rpc("records_sync_child_suggestions", {
        _org_id: orgId,
        _connection_id: connectionId,
        _family_id: link.family_id,
        _external_family_id: link.external_family_id,
        _children: childSuggestionRows(
          family.children,
          {
            linked: linkedPeople,
            entries: entries.filter((e) => e.family_id === link.family_id && !claimed.has(e.id)),
          },
          church.mode,
        ),
      });
      if (error) throw new Error(`suggested children write failed: ${error.message}`);
    }
  }

  await addedChildPhotos(db, options, result);
}

/** Photos of children a household added, fetched only after they were added; a member's own photo is never replaced. */
async function addedChildPhotos(db: RecordsRefreshClient, options: RefreshOptions, result: RefreshResult) {
  const { orgId, creds, source } = options;
  const waiting = (
    await allRows(
      () =>
        db
          .from("records_child_suggestions")
          .select("id, family_member_id, photo")
          .eq("org_id", orgId)
          .eq("state", "added")
          .order("id"),
      "added children",
    )
  ).filter((row) => row.photo);
  for (const row of waiting) {
    if (options.elapsed() >= options.budgetMs) {
      result.stoppedAtBudget = true;
      return;
    }
    const memberId = row.family_member_id;
    let bytes: Uint8Array | null = null;
    if (memberId) {
      try {
        bytes = await source.photo(creds, row.photo!, PHOTO_EDGE);
      } catch (err) {
        if (!(err instanceof RecordsError)) throw err;
        // Kept, so the next run tries again.
        continue;
      }
    }
    if (bytes && memberId) {
      const url = await options.storeChildPhoto(orgId, memberId, bytes);
      const { data, error } = await db
        .from("family_members")
        .update({ avatar_url: url })
        .eq("org_id", orgId)
        .eq("id", memberId)
        .is("avatar_url", null)
        .select("id");
      if (error) throw new Error(`child photo write failed: ${error.message}`);
      if (!data || data.length === 0) {
        // A retry after the token clear failed writes the key the photo already points at.
        const { data: member, error: readError } = await db
          .from("family_members")
          .select("avatar_url")
          .eq("org_id", orgId)
          .eq("id", memberId);
        if (readError) throw new Error(`child photo read failed: ${readError.message}`);
        if (member?.some((m) => m.avatar_url === url)) {
          await must(
            db.from("records_child_suggestions").update({ photo: null }).eq("org_id", orgId).eq("id", row.id),
            "child photo token clear",
          );
          continue;
        }
        const removed = await options.removeChildPhoto(orgId, memberId).then(() => true, (err) => {
          logError("church records copy couldn't remove an unused child photo", err, {
            route: "refresh-church-records",
            ids: { org: orgId, householdMember: memberId },
          });
          return false;
        });
        // The token is kept so the next run removes it again.
        if (!removed) continue;
      }
    } else if (memberId) {
      // An earlier run may have stored the photo and failed to remove it when
      // the member had their own; the kept token is the only record of it.
      const { data: member, error: readError } = await db
        .from("family_members")
        .select("avatar_url")
        .eq("org_id", orgId)
        .eq("id", memberId);
      if (readError) throw new Error(`child photo read failed: ${readError.message}`);
      const showsStored = member?.some((m) => m.avatar_url?.includes(`/family-members/${memberId}/records-photo.jpg`));
      if (!showsStored) {
        const removed = await options.removeChildPhoto(orgId, memberId).then(() => true, (err) => {
          logError("church records copy couldn't remove an unused child photo", err, {
            route: "refresh-church-records",
            ids: { org: orgId, householdMember: memberId },
          });
          return false;
        });
        if (!removed) continue;
      }
    }
    await must(
      db.from("records_child_suggestions").update({ photo: null }).eq("org_id", orgId).eq("id", row.id),
      "child photo token clear",
    );
  }
}
