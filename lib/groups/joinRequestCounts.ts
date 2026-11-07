import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/**
 * Requests to join waiting on each of these groups, keyed by group id. Pass
 * only groups the viewer leads: the SELECT policy shows a leader that group's
 * requests and a member none, so a member's count would read as zero. A group
 * whose count failed is left out, so its count is hidden rather than short.
 */
export async function getGroupWaitingRequestCounts(groupIds: string[]): Promise<Record<string, number>> {
  if (groupIds.length === 0) return {};
  const supabase = await createClient();
  const counts = await Promise.all(
    groupIds.map(async (groupId): Promise<[string, number] | null> => {
      const { count, error, status } = await supabase
        .from("group_join_requests")
        .select("id", { count: "exact", head: true })
        .eq("group_id", groupId)
        .eq("status", "pending");
      // A HEAD failure may carry no error at all: the missing count is the sure sign.
      if (error || count === null) {
        logError("Failed to count a group's join requests", error, { ids: { group: groupId, status } });
        return null;
      }
      return [groupId, count];
    }),
  );
  return Object.fromEntries(counts.filter((entry) => entry !== null));
}
