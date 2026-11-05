import { createClient } from "@/lib/supabase/server";
import { totalWaiting } from "./requestsWaiting";

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
    const { count, error } = await supabase
      .from(REQUEST_TABLES[kind])
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) {
      console.error("Failed to count %s requests: code=%s", kind, error.code);
      return null;
    }
    return count ?? 0;
  };
  const [access, group, join] = await Promise.all([count("access"), count("group"), count("join")]);
  return totalWaiting({ access, group, join });
}
