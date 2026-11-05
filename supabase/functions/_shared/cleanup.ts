// What the nightly cleanup deletes, one church at a time. The job runs on the
// service key, so the org_id predicate on each chain is the tenant boundary,
// bound to an id from listActiveOrgs(). Each rule is its own delete statement
// so its WHERE clause is checked at delete time: selecting ids first could
// delete an invite accepted in between.
//
// Deliberately free of any @supabase/supabase-js import so it can be unit
// tested offline against the structural types below.

import {
  expiredCutoff,
  feedbackCutoff,
  isLiveSignupToken,
  prayerCutoff,
  reminderCutoff,
} from "./retention.ts";
import { logError, logInfo } from "./log.ts";

/** Passes one call to a reminder prune function deletes at most. */
export const DELETE_BATCH = 500;

type QueryError = { message: string } | null;

interface FilterBuilder<Self> {
  eq(column: string, value: unknown): Self;
  is(column: string, value: null): Self;
  lt(column: string, value: string): Self;
  not(column: string, operator: string, value: unknown): Self;
}

export interface DeleteChain
  extends FilterBuilder<DeleteChain>, PromiseLike<{ count: number | null; error: QueryError }> {}

export interface ReadChain<Row = Record<string, unknown>>
  extends
    FilterBuilder<ReadChain<Row>>,
    PromiseLike<{ data: Row[] | null; count: number | null; error: QueryError }> {
  maybeSingle(): PromiseLike<{ data: Row | null; error: QueryError }>;
}

/** The narrow slice of the Supabase client this module needs. */
export interface CleanupClient {
  from(table: string): {
    delete(options: { count: "exact" }): DeleteChain;
    select(columns: string, options?: { count: "exact" }): ReadChain;
  };
  rpc(
    fn: "serving_reminder_passes_prune" | "event_reminder_passes_prune",
    args: { _org_id: string; _before: string; _limit: number },
  ): PromiseLike<{ data: number | null; error: QueryError }>;
}

export interface RemovedCounts {
  accessRequests: number;
  familyInvites: number;
  groupInvites: number;
  feedback: number;
  prayerRequests: number;
  reminderPasses: number;
  eventReminderPasses: number;
}

export interface OrgCleanupResult {
  orgId: string;
  removed: RemovedCounts;
  failures: Array<{ step: string; error: string }>;
}

function assertWholeRead(step: string, rows: unknown[] | null, count: number | null): unknown[] {
  if (rows === null || count === null || rows.length !== count) {
    throw new Error(`${step}: read ${rows?.length ?? "no"} of ${count ?? "unknown"} rows`);
  }
  return rows;
}

/**
 * Household invite tokens a usable request still needs: a pending one, or an
 * approved one whose setup link still works. Throws on an error or a read the
 * row cap cut short, because a missed token deletes an invite still in use.
 */
async function liveInviteTokens(
  supabase: CleanupClient,
  orgId: string,
  now: Date,
): Promise<string[]> {
  const pending = await supabase
    .from("access_requests")
    .select("invite_token", { count: "exact" })
    .eq("org_id", orgId)
    .eq("status", "pending")
    .not("invite_token", "is", null);
  if (pending.error) throw new Error(pending.error.message);
  const approved = await supabase
    .from("access_requests")
    .select("invite_token, token_expires_at", { count: "exact" })
    .eq("org_id", orgId)
    .eq("status", "approved")
    .not("invite_token", "is", null)
    .not("signup_token", "is", null);
  if (approved.error) throw new Error(approved.error.message);

  const pendingRows = assertWholeRead("pending requests", pending.data, pending.count) as Array<
    { invite_token: string }
  >;
  const approvedRows = assertWholeRead("approved requests", approved.data, approved.count) as Array<
    { invite_token: string; token_expires_at: string | null }
  >;
  return [
    ...new Set([
      ...pendingRows.map((row) => row.invite_token),
      ...approvedRows
        .filter((row) => isLiveSignupToken(row.token_expires_at, now))
        .map((row) => row.invite_token),
    ]),
  ];
}

/**
 * Runs every rule for one church. A failed step is recorded and the rest still
 * run, because the rules do not depend on each other's success.
 */
export async function cleanUpOrg(
  supabase: CleanupClient,
  orgId: string,
  now: Date,
): Promise<OrgCleanupResult> {
  const removed: RemovedCounts = {
    accessRequests: 0,
    familyInvites: 0,
    groupInvites: 0,
    feedback: 0,
    prayerRequests: 0,
    reminderPasses: 0,
    eventReminderPasses: 0,
  };
  const failures: OrgCleanupResult["failures"] = [];

  async function attempt(step: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      failures.push({ step, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // A filtered delete that matches nothing also succeeds, so only the returned
  // count says what happened; a missing one must not read as zero.
  function remove(key: keyof RemovedCounts, step: string, chain: () => DeleteChain) {
    return attempt(step, async () => {
      const { count, error } = await chain();
      if (error) throw new Error(error.message);
      if (count === null) throw new Error("the delete returned no count");
      removed[key] += count;
    });
  }

  const expired = expiredCutoff(now);

  await remove("accessRequests", "access_requests declined", () =>
    supabase
      .from("access_requests")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "denied")
      .lt("reviewed_at", expired));

  // Founding admin rows carry approved_role and are the only record of a new
  // church's first admin, so a null role is what makes a row eligible. A used
  // setup link has a null signup_token and belongs to someone who joined.
  await remove("accessRequests", "access_requests expired link", () =>
    supabase
      .from("access_requests")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "approved")
      .is("approved_role", null)
      .not("signup_token", "is", null)
      .lt("token_expires_at", expired));

  await attempt("family_invites", async () => {
    const live = await liveInviteTokens(supabase, orgId, now);
    const keepLive = (chain: DeleteChain) =>
      live.length ? chain.not("token", "in", `(${live.join(",")})`) : chain;

    await remove("familyInvites", "family_invites sent", () =>
      keepLive(
        supabase
          .from("family_invites")
          .delete({ count: "exact" })
          .eq("org_id", orgId)
          .is("accepted_at", null)
          .lt("sent_at", expired),
      ));
    await remove("familyInvites", "family_invites never sent", () =>
      keepLive(
        supabase
          .from("family_invites")
          .delete({ count: "exact" })
          .eq("org_id", orgId)
          .is("accepted_at", null)
          .is("sent_at", null)
          .lt("created_at", expired),
      ));
  });

  // group_invite_uses goes with its invite through the foreign key.
  await remove("groupInvites", "group_invites revoked", () =>
    supabase
      .from("group_invites")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .lt("revoked_at", expired));
  await remove("groupInvites", "group_invites expired", () =>
    supabase
      .from("group_invites")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .lt("expires_at", expired));

  await remove("feedback", "feedback", () =>
    supabase
      .from("feedback")
      .delete({ count: "exact" })
      .eq("org_id", orgId)
      .lt("created_at", feedbackCutoff(now)));

  // Read here rather than on listActiveOrgs(): functions deploy before
  // migrations, and a column missing from that shared select would stop the
  // reminder jobs during the window. A failed read deletes nothing and is
  // reported, never treated as off.
  await attempt("prayer_requests", async () => {
    const { data, error } = await supabase
      .from("organizations")
      .select("prayer_request_retention_months")
      .eq("id", orgId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("the church's row was not returned");
    const cutoff = prayerCutoff(data.prayer_request_retention_months, now);
    if (cutoff === null) return;
    // prayer_responses goes with its request through the foreign key.
    await remove("prayerRequests", "prayer_requests", () =>
      supabase
        .from("prayer_requests")
        .delete({ count: "exact" })
        .eq("org_id", orgId)
        .lt("created_at", cutoff));
  });

  // A table that grows every day is cleared a bounded set at a time, so one
  // night after a gap never deletes everything in one statement. The
  // database API cannot limit a delete, so the bound lives in the function.
  function prune(
    key: "reminderPasses" | "eventReminderPasses",
    table: "serving_reminder_passes" | "event_reminder_passes",
  ) {
    return attempt(table, async () => {
      for (;;) {
        const { data, error } = await supabase.rpc(`${table}_prune`, {
          _org_id: orgId,
          _before: reminderCutoff(now),
          _limit: DELETE_BATCH,
        });
        if (error) throw new Error(error.message);
        if (data === null) throw new Error("the delete returned no count");
        removed[key] += data;
        if (data < DELETE_BATCH) return;
      }
    });
  }

  await prune("reminderPasses", "serving_reminder_passes");
  await prune("eventReminderPasses", "event_reminder_passes");

  return { orgId, removed, failures };
}

/** Runs each church in turn and logs ids and counts only, never row content. */
export async function cleanUpOrgs(
  supabase: CleanupClient,
  orgIds: string[],
  now: Date,
): Promise<OrgCleanupResult[]> {
  const results: OrgCleanupResult[] = [];
  for (const orgId of orgIds) {
    const result = await cleanUpOrg(supabase, orgId, now);
    logInfo("expired data removed", { ids: { org: orgId, ...result.removed } });
    for (const { step, error } of result.failures) {
      logError("cleanup failed", error, { step: step.replaceAll(" ", "_"), ids: { org: orgId } });
    }
    results.push(result);
  }
  return results;
}

/** The response body. Any failure makes the run a 500, never a quiet zero. */
export function summarizeCleanup(results: OrgCleanupResult[]): {
  orgs: number;
  removed: Array<{ org: string } & RemovedCounts>;
  failed: Array<{ org: string; step: string; error: string }>;
} {
  return {
    orgs: results.length,
    removed: results.map((result) => ({ org: result.orgId, ...result.removed })),
    failed: results.flatMap((result) =>
      result.failures.map((failure) => ({ org: result.orgId, ...failure }))
    ),
  };
}
