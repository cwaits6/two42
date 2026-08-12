import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, initials } from "@/lib/names";
import { mintSignedUrls } from "@/lib/storageRead";
import type { MemberOption } from "@/components/giving/FundForm";

/** Whether members may put up and manage their own giving links */
export async function givingStewardsCanManage(
  supabase: SupabaseClient
): Promise<boolean> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "giving_manage_mode")
    .maybeSingle();
  return (data?.value ?? "stewards") === "stewards";
}

/** Both giving settings in one query, for the admin page */
export async function getGivingSettings(supabase: SupabaseClient): Promise<{
  stewardsCanManage: boolean;
  dashboardTile: boolean;
}> {
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .in("key", ["giving_manage_mode", "giving_dashboard_tile"]);
  const map = new Map((data ?? []).map((s) => [s.key, s.value]));
  return {
    stewardsCanManage: (map.get("giving_manage_mode") ?? "stewards") === "stewards",
    dashboardTile: (map.get("giving_dashboard_tile") ?? "on") === "on",
  };
}

/** Member picker options for the fund form */
export async function loadFundFormData(supabase: SupabaseClient): Promise<{
  members: MemberOption[];
}> {
  const { data: memberRows } = await supabase
    .from("profiles_directory")
    .select("id, first_name, last_name, preferred_name, avatar_url")
    .order("last_name")
    .order("first_name");

  // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
  // before they reach the member-picker renders. Signing goes through
  // lib/storageRead's own cookie-bound client, never the caller's `supabase`
  // parameter — a passed-in client is untyped as to privilege (Tier C).
  const rows = memberRows ?? [];
  const signedAvatars = await mintSignedUrls(rows.map((p) => p.avatar_url));
  const members: MemberOption[] = rows.map((p, i) => ({
    id: p.id,
    name: displayName(p),
    initials: initials(p),
    avatarUrl: signedAvatars[i],
  }));

  return { members };
}
