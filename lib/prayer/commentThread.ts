// Comments are read only here, on the server: the text is sealed, and two of a
// private comment's readers, a hidden-name writer and the author of an
// anonymous request, are known only by a keyed hash the database cannot
// compute. So the table grants no client anything and this decides who sees
// each comment.
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Tables } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { decryptBody, isAuthor, type PrayerKeys } from "./crypto";
import type { PrayerCommentView } from "./comments";

type CommentRow = Tables<"prayer_comments">;

export type SealedCommentRow = Pick<
  CommentRow,
  "id" | "request_id" | "body_ciphertext" | "only_asker" | "hide_name" | "writer_id" | "writer_hash" | "created_at"
>;

/** Every comment on the group's requests, oldest first. `orgId` must come from an anchor the caller already validated. */
export function readCommentRows(client: SupabaseClient, orgId: string, groupId: string) {
  return fetchAll<SealedCommentRow, PostgrestError>((from, to) =>
    client
      .from("prayer_comments")
      .select(
        "id, request_id, body_ciphertext, only_asker, hide_name, writer_id, writer_hash, created_at, prayer_requests!inner(group_id)",
      )
      .eq("org_id", orgId)
      .eq("prayer_requests.group_id", groupId)
      .order("created_at")
      .order("id")
      .range(from, to)
      .returns<SealedCommentRow[]>(),
  );
}

/** Whether the viewer wrote the row: by id when named, else by the keyed hash over the row id. Requests use it too. */
export function wroteComment(
  keys: PrayerKeys,
  orgId: string,
  viewerId: string,
  row: Pick<SealedCommentRow, "id" | "writer_id" | "writer_hash">,
): boolean {
  if (row.writer_id) return row.writer_id === viewerId;
  return row.writer_hash !== null && isAuthor(keys, orgId, row.id, viewerId, row.writer_hash);
}

export interface OpenedComment {
  view: Omit<PrayerCommentView, "first_name" | "last_name" | "preferred_name">;
  /** For the name lookup only; never sent to the browser. Null on a hidden-name comment. */
  writerId: string | null;
}

/**
 * The comments the viewer may read, opened. A private comment reaches only its
 * writer and the person who posted the request (`mine` on the opened wall row,
 * which recognises an anonymous author by hash); one the viewer may not read is
 * dropped before its text is opened. Comments on a request not in `requests`
 * are dropped too. Throws when any text the viewer may read fails to open.
 */
export function openComments(
  rows: readonly SealedCommentRow[],
  opts: {
    viewerId: string;
    orgId: string;
    keys: PrayerKeys;
    isLeader: boolean;
    requests: ReadonlyMap<string, { mine: boolean }>;
  },
): OpenedComment[] {
  return rows.flatMap((row) => {
    const request = opts.requests.get(row.request_id);
    if (!request) return [];
    const wrote = wroteComment(opts.keys, opts.orgId, opts.viewerId, row);
    if (row.only_asker && !wrote && !request.mine) return [];
    return [
      {
        view: {
          id: row.id,
          request_id: row.request_id,
          body: decryptBody(opts.keys, opts.orgId, row.id, row.body_ciphertext),
          only_asker: row.only_asker,
          hide_name: row.hide_name,
          created_at: row.created_at,
          mine: wrote,
          can_delete: wrote || request.mine || opts.isLeader,
        },
        writerId: row.hide_name ? null : row.writer_id,
      },
    ];
  });
}

export type CommentWriterName = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };

/** Names of the named writers the client can see; pass the request client so the profiles read policy decides. */
export async function commentWriterNames(client: SupabaseClient, orgId: string, ids: readonly string[]) {
  if (ids.length === 0) return { data: [] as CommentWriterName[], error: null };
  const { data, error } = await client
    .from("profiles")
    .select("id, first_name, last_name, preferred_name")
    .eq("org_id", orgId)
    .in("id", [...new Set(ids)])
    .returns<CommentWriterName[]>();
  return error ? { data: null, error } : { data: data ?? [], error: null };
}

export type HashedCommentRow = SealedCommentRow & { prayer_requests: { groups: { name: string } | null } | null };

/**
 * The person's hidden-name comments, which no foreign key ties to them: every
 * hidden-name comment in the church is read, since only the author key tells
 * whose is whose. `orgId` must come from an anchor the caller already validated.
 */
export async function hashedCommentsOf(client: SupabaseClient, orgId: string, personId: string, keys: PrayerKeys) {
  const { data, error } = await fetchAll<HashedCommentRow, PostgrestError>((from, to) =>
    client
      .from("prayer_comments")
      .select(
        "id, request_id, body_ciphertext, only_asker, hide_name, writer_id, writer_hash, created_at, prayer_requests(groups(name))",
      )
      .eq("org_id", orgId)
      .is("writer_id", null)
      .order("id")
      .range(from, to)
      .returns<HashedCommentRow[]>(),
  );
  if (error) return { data: null, error };
  return { data: (data ?? []).filter((row) => wroteComment(keys, orgId, personId, row)), error: null };
}
