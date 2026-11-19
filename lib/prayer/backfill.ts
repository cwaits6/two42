// The backfill's writes. Imported by scripts/encrypt-prayer-requests.mjs
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
 * The ciphertext guard covers an overlapping run, which leaves updated_at as is.
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
  for (const column of ["author_id", "author_hash", "body_ciphertext"] as const) {
    const value = row[column];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }
  const { data, error } = await query.select("id");
  if (error) return "failed";
  return data.length === 1 ? "written" : "changed meanwhile";
}

/** The comment columns the rotation script reads; the row type is derived from them so the two can't drift. */
export const COMMENT_COLUMNS = ["id", "org_id", "body_ciphertext", "hide_name", "writer_id", "writer_hash"] as const;
export type BackfillCommentRow = Pick<Tables<"prayer_comments">, (typeof COMMENT_COLUMNS)[number]>;

/** A comment in the shape planRow reads: its writer hash plans as an anonymous author hash. */
export function commentAsStoredRow(row: BackfillCommentRow): StoredRow {
  return {
    id: row.id,
    org_id: row.org_id,
    body: null,
    body_ciphertext: row.body_ciphertext,
    is_anonymous: row.hide_name,
    author_id: row.writer_id,
    author_hash: row.writer_hash,
  };
}

/**
 * Applies one planned write to a comment. Comments are never edited, so only
 * an overlapping run or a delete can change one after the plan: the write is
 * guarded on the ciphertext and writer hash it read.
 */
export async function writeCommentPlan(
  client: SupabaseClient<Database>,
  row: BackfillCommentRow,
  plan: Extract<RowPlan, { action: "write" }>,
): Promise<WriteOutcome> {
  const update = client
    .from("prayer_comments")
    .update({ body_ciphertext: plan.patch.body_ciphertext, writer_hash: plan.patch.author_hash })
    .eq("org_id", row.org_id)
    .eq("id", row.id)
    .eq("body_ciphertext", row.body_ciphertext);
  const guarded = row.writer_hash === null ? update.is("writer_hash", null) : update.eq("writer_hash", row.writer_hash);
  const { data, error } = await guarded.select("id");
  if (error) return "failed";
  return data.length === 1 ? "written" : "changed meanwhile";
}
