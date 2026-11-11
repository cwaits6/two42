/**
 * Executes a validated ImportPlan. Lives here rather than in the
 * route so it is reachable from a test: it already took the Supabase client
 * as a parameter, so moving it costs an import and puts it on the correct
 * side of the pure/IO line the rest of lib/members/ commits to. A wrong
 * .eq() here flips is_leader on the wrong row, or silently no-ops — and a
 * no-op is indistinguishable from success without a test.
 *
 * Tenancy: `orgId` scopes EVERY write, insert included. A
 * `SupabaseClient<Database>` PARAMETER is untyped as to privilege — a
 * service-role client satisfies it identically and carries BYPASSRLS — so
 * from inside lib/ this code cannot know whether RLS is running at all, and
 * the explicit predicate is the only tenant boundary it can guarantee (the
 * same tier-C reasoning as loadOrgSnapshot).
 *
 * That cuts two ways, and both matter:
 *   - Inserts carry an explicit org_id instead of leaning on the column
 *     DEFAULT public.app_current_org_id(). The DEFAULT is the fail-closed
 *     resolver for an authenticated principal, but under a service-role
 *     client there is no authenticated principal to resolve, so it yields
 *     nothing useful.
 *   - Updates and deletes carry .eq("org_id", orgId) alongside their id
 *     predicate. An id-only update is the leak: a row id belonging to
 *     another tenant would be written without it.
 *
 * `orgId` must come from a validated anchor — requireOrgAdmin() reads it off
 * the caller's own RLS-scoped profile row. Never off a request body.
 *
 * PII: response bodies may carry member data (the admin uploaded the file);
 * log lines must not. They carry line numbers, kinds, counts, and the error code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PlannedWrite } from "@/lib/members/import-plan";
import { logError } from "@/lib/log";
import { titleCaseName } from "@/lib/sanitize";

export type ApplyResult =
  | { ok: true; applied: number; appliedLines: number[] }
  | {
      ok: false;
      applied: number;
      /** 1-based index into the plan's write list. */
      failedAt: number;
      /** CSV data-row number of the write that failed. */
      failedAtLine: number;
      failedKind: PlannedWrite["kind"];
      /** Lines whose EVERY planned write landed — the set an admin can
       *  safely delete from the file before re-uploading. */
      appliedLines: number[];
    };

/**
 * Turn a matched-no-rows UPDATE/DELETE into a failure.
 *
 * PostgREST reports "matched nothing" as `error: null` with an empty result
 * set, so without `.select()` every update and delete here is indistinguishable
 * from a successful one. That is not a hypothetical: the `.eq("org_id", orgId)`
 * predicate this module adds is exactly the kind of predicate that silently
 * matches nothing, so the tenancy fix would otherwise have made the failure
 * mode WORSE — a row from another tenant (or a row whose org_id disagrees with
 * the caller's) would be skipped and reported as applied, and the admin's
 * `appliedLines` would tell them to delete a line from their file that never
 * actually landed.
 *
 * Zero rows is treated as a hard failure for deletes too, not just updates.
 * "The membership was already gone" is the benign reading, but it is
 * indistinguishable here from the alarming one — an org_id mismatch, meaning
 * the snapshot the plan was computed from disagrees with what the database
 * will let this caller write. Aborting is recoverable (the plan is recomputed
 * from a fresh snapshot on the next run); a false "applied" is not.
 */
function noRowsTouched(
  data: unknown[] | null,
  kind: string
): Error | null {
  if (data !== null && data.length > 0) return null;
  return new Error(
    `${kind} matched no row — the target is missing, or its org_id disagrees ` +
      "with the caller's; nothing was written"
  );
}

/**
 * Capitalizes a name the import inserts. Only the case may change: the plan
 * matches saved rows on the trimmed, lowercased name, so a collapsed space
 * would make the next import miss this row and insert it again.
 */
function capitalized<T extends string | undefined>(name: T): T {
  if (!name) return name;
  const cased = titleCaseName(name);
  return (cased?.toLowerCase() === name.trim().toLowerCase() ? cased : name) as T;
}

/**
 * Execute planned writes in dependency order. Household inserts feed their
 * new ids to the family_members inserts that reference them by the per-file
 * household key, which is why the plan's ordering is load-bearing.
 *
 * Stops at the first failure: PostgREST gives no cross-statement
 * transaction, so continuing past one would only make the partial state
 * larger. What the caller reports about that partial state is the thing that
 * matters — hence appliedLines.
 */
export async function applyWrites(
  supabase: SupabaseClient<Database>,
  userId: string,
  orgId: string,
  writes: PlannedWrite[]
): Promise<ApplyResult> {
  const familyIdByKey = new Map<string, string>();
  let applied = 0;

  // A CSV row commonly produces 3–5 writes, so "applied" alone tells an admin
  // nothing about their file. Track which lines are fully done.
  const plannedPerLine = new Map<number, number>();
  for (const write of writes) {
    plannedPerLine.set(write.line, (plannedPerLine.get(write.line) ?? 0) + 1);
  }
  const appliedPerLine = new Map<number, number>();
  const completedLines = (): number[] =>
    [...appliedPerLine.entries()]
      .filter(([line, count]) => count === plannedPerLine.get(line))
      .map(([line]) => line)
      .sort((a, b) => a - b);

  for (let i = 0; i < writes.length; i++) {
    const write = writes[i];
    let failure: unknown = null;

    try {
      switch (write.kind) {
        case "insert_family_unit": {
          const { data, error } = await supabase
            .from("family_units")
            .insert({
              ...write.values,
              family_name: capitalized(write.values.family_name),
              org_id: orgId,
            })
            .select("id")
            .single();
          if (error || !data) {
            failure = error ?? new Error("insert returned no row");
            break;
          }
          familyIdByKey.set(write.householdKey, data.id);
          break;
        }
        case "update_family_unit": {
          const { data, error } = await supabase
            .from("family_units")
            .update(write.values)
            .eq("id", write.id)
            .eq("org_id", orgId)
            .select("id");
          failure = error ?? noRowsTouched(data, "update_family_unit");
          break;
        }
        case "insert_family_member": {
          const familyId =
            write.familyId ?? familyIdByKey.get(write.householdKey ?? "");
          if (!familyId) {
            failure = new Error("household key resolved no family id");
            break;
          }
          const { error } = await supabase
            .from("family_members")
            .insert({
              ...write.values,
              first_name: capitalized(write.values.first_name),
              last_name: capitalized(write.values.last_name),
              preferred_name: capitalized(write.values.preferred_name),
              family_id: familyId,
              org_id: orgId,
            });
          failure = error;
          break;
        }
        case "update_family_member": {
          const { data, error } = await supabase
            .from("family_members")
            .update(write.values)
            .eq("id", write.id)
            .eq("org_id", orgId)
            .select("id");
          failure = error ?? noRowsTouched(data, "update_family_member");
          break;
        }
        case "update_profile": {
          const { data, error } = await supabase
            .from("profiles")
            .update(write.values)
            .eq("id", write.id)
            .eq("org_id", orgId)
            .select("id");
          failure = error ?? noRowsTouched(data, "update_profile");
          break;
        }
        case "insert_profile_group": {
          const { error } = await supabase.from("team_members").insert({
            profile_id: write.profileId,
            team_id: write.groupId,
            is_leader: write.isLeader,
            assigned_by: userId,
            org_id: orgId,
          });
          failure = error;
          break;
        }
        case "update_profile_group": {
          const { data, error } = await supabase
            .from("team_members")
            .update({ is_leader: write.isLeader })
            .eq("profile_id", write.profileId)
            .eq("team_id", write.groupId)
            .eq("org_id", orgId)
            .select("profile_id");
          failure = error ?? noRowsTouched(data, "update_profile_group");
          break;
        }
        case "delete_profile_group": {
          const { data, error } = await supabase
            .from("team_members")
            .delete()
            .eq("profile_id", write.profileId)
            .eq("team_id", write.groupId)
            .eq("org_id", orgId)
            .select("profile_id");
          failure = error ?? noRowsTouched(data, "delete_profile_group");
          break;
        }
        default: {
          // A new PlannedWrite variant must not fall through and be counted
          // as applied. This fails the build the moment one is added without
          // a case here.
          const unreachable: never = write;
          failure = new Error(
            `unhandled write kind: ${(unreachable as PlannedWrite).kind}`
          );
        }
      }
    } catch (err) {
      // A thrown error (transport, abort) is a failure like any other — not
      // an unhandled rejection that loses the `applied` accounting.
      failure = err;
    }

    if (failure) {
      logError("members import: apply failed at write", failure, {
        step: write.kind,
        ids: { write: i + 1, writes: writes.length, line: write.line },
      });
      return {
        ok: false,
        applied,
        failedAt: i + 1,
        failedAtLine: write.line,
        failedKind: write.kind,
        appliedLines: completedLines(),
      };
    }
    applied += 1;
    appliedPerLine.set(write.line, (appliedPerLine.get(write.line) ?? 0) + 1);
  }

  return { ok: true, applied, appliedLines: completedLines() };
}
