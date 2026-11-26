// What the church's records lock, for screens that write people's details in
// bulk. The database keeps a locked value whatever is sent; reading the locks
// first lets those screens say so instead of reporting a change that never
// lands.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";

/**
 * The people in `orgId` whose name comes locked from the church's records.
 * `orgId` must come from a validated anchor such as requireOrgAdmin(); the
 * filter on it holds whichever client is passed.
 */
export async function lockedNameProfiles(supabase: SupabaseClient<Database>, orgId: string): Promise<Set<string>> {
  const { data: setting, error: settingError } = await supabase
    .from("records_field_settings")
    .select("mode")
    .eq("org_id", orgId)
    .eq("field", "name")
    .maybeSingle();
  if (settingError) throw new Error("Failed to load records_field_settings");
  if (setting?.mode !== "locked") return new Set();
  const { data, error } = await fetchAll((from, to) =>
    supabase
      .from("records_field_values")
      .select("profile_id")
      .eq("org_id", orgId)
      .eq("field", "name")
      .order("profile_id")
      .range(from, to),
  );
  if (error) throw new Error("Failed to load records_field_values");
  return new Set((data ?? []).map((row) => row.profile_id));
}
