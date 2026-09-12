/**
 * Server-side giving helpers.
 *
 * Tenancy: every helper that takes a Supabase client also takes `orgId` and
 * scopes each chain on it. A `SupabaseClient` PARAMETER is untyped as to
 * privilege — a service-role client satisfies it identically and carries
 * BYPASSRLS — so from inside lib/ this code cannot know whether RLS is
 * running, and the explicit predicate is the only tenant boundary it can
 * guarantee. `orgId` must come from a validated anchor: the caller's own
 * RLS-scoped profile row, never a request body.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, initials } from "@/lib/names";
import { mintSignedUrls } from "@/lib/storageRead";
import type { MemberOption } from "@/components/giving/FundForm";

/** Whether members may put up and manage their own giving links */
export async function givingStewardsCanManage(
  supabase: SupabaseClient,
  orgId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", "giving_manage_mode")
    .maybeSingle();
  return (data?.value ?? "stewards") === "stewards";
}

/** Both giving settings in one query, for the admin page */
export async function getGivingSettings(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  stewardsCanManage: boolean;
  dashboardTile: boolean;
}> {
  const { data } = await supabase
    .from("site_settings")
    .select("key, value")
    .eq("org_id", orgId)
    .in("key", ["giving_manage_mode", "giving_dashboard_tile"]);
  const map = new Map((data ?? []).map((s) => [s.key, s.value]));
  return {
    stewardsCanManage: (map.get("giving_manage_mode") ?? "stewards") === "stewards",
    dashboardTile: (map.get("giving_dashboard_tile") ?? "on") === "on",
  };
}

type StewardAvatarSource = {
  steward?: { avatar_url: string | null } | null;
  co_steward?: { avatar_url: string | null } | null;
};

/**
 * Private buckets: flattens each fund's steward + co-steward
 * avatar URLs into one batch (fixed 2-slot stride per fund), mints signed
 * URLs, then reassembles them back onto the steward/co_steward objects.
 * Named and unit tested on its own because the stride arithmetic (`i * 2`,
 * `i * 2 + 1`) silently misaligns if a third avatar field is ever added
 * without updating both the flatten and the reassembly in lockstep.
 */
export async function signStewardAvatars<T extends StewardAvatarSource>(
  funds: T[],
): Promise<T[]> {
  const urls = funds.flatMap((f) => [
    f.steward?.avatar_url ?? null,
    f.co_steward?.avatar_url ?? null,
  ]);
  const signed = await mintSignedUrls(urls);
  return funds.map((f, i) => ({
    ...f,
    steward: f.steward ? { ...f.steward, avatar_url: signed[i * 2] } : f.steward,
    co_steward: f.co_steward
      ? { ...f.co_steward, avatar_url: signed[i * 2 + 1] }
      : f.co_steward,
  }));
}

/** Member picker options for the fund form */
export async function loadFundFormData(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  members: MemberOption[];
}> {
  const { data: memberRows } = await supabase
    .from("profiles_directory")
    .select("id, first_name, last_name, preferred_name, avatar_url")
    .eq("org_id", orgId)
    .order("last_name")
    .order("first_name");

  // Private buckets: exchange stored avatar URLs for signed URLs
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
