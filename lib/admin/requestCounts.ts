import { createClient } from "@/lib/supabase/server";
import { totalWaiting } from "./requestsWaiting";
import { logError } from "@/lib/log";

const REQUEST_TABLES = {
  access: "access_requests",
  group: "group_requests",
  join: "group_join_requests",
} as const;

/**
 * The number of requests waiting across the church, for a church admin: the
 * admin arm of each table's SELECT policy returns the whole church's rows, so
 * anyone else gets a count of only what they may see. Null when any count
 * fails; show no number then, never a short one.
 */
export async function getWaitingRequestCount(): Promise<number | null> {
  const supabase = await createClient();
  const count = async (kind: keyof typeof REQUEST_TABLES): Promise<number | null> => {
    const { count, error, status } = await supabase
      .from(REQUEST_TABLES[kind])
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    // A HEAD response has no body, so a failure carries no code and some carry
    // no error at all: the missing count is the only sure sign of one.
    if (error || count === null) {
      logError("Failed to count requests", error, { step: REQUEST_TABLES[kind], ids: { status } });
      return null;
    }
    return count;
  };
  const [access, group, join] = await Promise.all([count("access"), count("group"), count("join")]);
  return totalWaiting({ access, group, join });
}
