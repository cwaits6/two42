// The backfill's one write. Imported by scripts/encrypt-prayer-requests.mjs
// under Node's type stripping, so it imports types only. Keep it that way.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../supabase/database.types";
import type { RowPlan, StoredRow } from "./crypto";

export type BackfillRow = StoredRow & Pick<Tables<"prayer_requests">, "updated_at">;
export type WriteOutcome = "written" | "changed meanwhile" | "failed";

/**
 * Applies one planned write. The script never sets updated_at and every app
 * write does, so the write is guarded on the updated_at and author form it
 * read: a row the app changed after the plan is left alone, never reverted.
 */
export async function writePlan(
  client: SupabaseClient<Database>,
  row: BackfillRow,
  plan: Extract<RowPlan, { action: "write" }>,
): Promise<WriteOutcome> {
  let query = client
    .from("prayer_requests")
    .update(plan.patch)
    .eq("org_id", row.org_id)
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .eq("is_anonymous", row.is_anonymous);
  for (const column of ["author_id", "author_hash"] as const) {
    const value = row[column];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.select("id");
  if (error) return "failed";
  return data.length === 1 ? "written" : "changed meanwhile";
}
