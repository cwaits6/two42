import { createClient } from "@/lib/supabase/server";
import {
  toPendingJoinRequest,
  type JoinQueueGroup,
  type PendingJoinRequest,
  type PendingJoinRequestRow,
} from "@/lib/groups/joinQueue";

/**
 * Every pending join request across the given groups: one
 * pending_group_join_requests() call per group through the cookie-bound
 * request client. The function resolves the org from the caller's own
 * profile and returns rows only to org admins and the group's leaders, so
 * the group ids need no further scoping than the RLS read that produced
 * them. Null when any call fails, so the page can say so rather than show
 * a queue that is quietly short.
 */
export async function getPendingJoinRequests(
  groups: JoinQueueGroup[],
): Promise<PendingJoinRequest[] | null> {
  const supabase = await createClient();
  const perGroup = await Promise.all(
    groups.map(async (group) => {
      const { data, error } = await supabase.rpc("pending_group_join_requests", {
        _group_id: group.id,
      });
      if (error) {
        console.error("Failed to load pending join requests for group:", group.id, error);
        return null;
      }
      const rows: PendingJoinRequestRow[] = data ?? [];
      return rows.map((raw) => toPendingJoinRequest(group, raw));
    }),
  );
  if (perGroup.some((rows) => rows === null)) return null;
  return perGroup.flatMap((rows) => rows ?? []);
}
