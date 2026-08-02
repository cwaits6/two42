/**
 * Executes a validated ImportPlan (CWA-40). Lives here rather than in the
 * route so it is reachable from a test: it already took the Supabase client
 * as a parameter, so moving it costs an import and puts it on the correct
 * side of the pure/IO line the rest of lib/members/ commits to. A wrong
 * .eq() here flips is_leader on the wrong row, or silently no-ops — and a
 * no-op is indistinguishable from success without a test.
 *
 * Tenancy: no insert payload carries org_id. Every target table's column
 * DEFAULT is public.app_current_org_id(), the fail-closed resolver, and the
 * client is the caller's cookie-bound request client, so RLS is the boundary
 * on both the reads and the writes. `orgId` is threaded in only to scope the
 * updates/deletes, which address rows by id and would otherwise rely on RLS
 * alone against a client this signature cannot prove is request-scoped (the
 * same tier-C reasoning as loadOrgSnapshot).
 *
 * PII: response bodies may carry member data (the admin uploaded the file);
 * console.* must not. Log lines, kinds, counts, and the constraint identity.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { PlannedWrite } from "@/lib/members/import-plan";

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
 * Reduce a write failure to the parts that are safe to log.
 *
 * The distinction that matters is who produced the error. A SQLSTATE means
 * Postgres, whose `details`/`hint` echo the offending row on a constraint
 * violation — `Key (email, org_id)=(ada@example.com, …) already exists` is
 * member PII, so those fields are dropped. No SQLSTATE means the error came
 * from postgrest-js or PostgREST, neither of which has ever seen a row
 * value: a client-side network failure is synthesized with `code: ''`,
 * `hint: ''`, and the entire diagnostic (DNS, ECONNRESET, the cause chain)
 * in `details`, and PGRST* schema-cache errors put the fix in `hint`. On the
 * failure mode most likely to hit production — a transient network blip
 * mid-apply — dropping those leaves nothing to debug with.
 *
 * Caveat on `message`: Postgres input-conversion errors (22P02, 22023) echo
 * the offending literal. Narrow in practice, because the planner validates
 * enums, dates and birth parts before any write, so the residue is a type
 * token rather than a member value.
 */
export function redactFailure(failure: unknown): string {
  if (failure && typeof failure === "object" && "code" in failure) {
    const e = failure as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const code = String(e.code ?? "");
    const base = `code=${code || "unknown"} message=${String(e.message ?? "")}`;
    const fromPostgres = code !== "" && !code.startsWith("PGRST");
    if (fromPostgres) return base;
    return `${base} details=${String(e.details ?? "")} hint=${String(e.hint ?? "")}`;
  }
  return failure instanceof Error ? failure.message : "unknown error";
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
            .insert({ family_name: write.values.family_name })
            .select("id")
            .single();
          if (error || !data) {
            failure = error ?? new Error("insert returned no row");
            break;
          }
          familyIdByKey.set(write.householdKey, data.id);
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
            .insert({ ...write.values, family_id: familyId });
          failure = error;
          break;
        }
        case "update_family_member": {
          const { error } = await supabase
            .from("family_members")
            .update(write.values)
            .eq("id", write.id)
            .eq("org_id", orgId);
          failure = error;
          break;
        }
        case "update_profile": {
          const { error } = await supabase
            .from("profiles")
            .update(write.values)
            .eq("id", write.id)
            .eq("org_id", orgId);
          failure = error;
          break;
        }
        case "insert_profile_group": {
          const { error } = await supabase.from("profile_groups").insert({
            profile_id: write.profileId,
            group_id: write.groupId,
            is_leader: write.isLeader,
            assigned_by: userId,
          });
          failure = error;
          break;
        }
        case "update_profile_group": {
          const { error } = await supabase
            .from("profile_groups")
            .update({ is_leader: write.isLeader })
            .eq("profile_id", write.profileId)
            .eq("group_id", write.groupId)
            .eq("org_id", orgId);
          failure = error;
          break;
        }
        case "delete_profile_group": {
          const { error } = await supabase
            .from("profile_groups")
            .delete()
            .eq("profile_id", write.profileId)
            .eq("group_id", write.groupId)
            .eq("org_id", orgId);
          failure = error;
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
      // Counts, positions, kinds, and the constraint identity only — a failed
      // write's payload (and the driver's echo of it) is member PII.
      console.error(
        "members import: apply failed at write %d/%d (line %d, %s): %s",
        i + 1,
        writes.length,
        write.line,
        write.kind,
        redactFailure(failure)
      );
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
