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
import { readList } from "@/lib/supabase/readList";
import type { MemberOption } from "@/components/giving/FundForm";
import { logError } from "@/lib/log";

/**
 * The church's stored giving rule: whether members may put up and manage their
 * own giving links. A church with no row has the default, which is that they
 * may. Null when the read failed, for a control that must not show a value the
 * church doesn't have.
 */
export async function readStewardsCanManage(
  supabase: SupabaseClient,
  orgId: string
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", "giving_manage_mode")
    .maybeSingle();
  if (error) {
    logError("Failed to load the giving setting", error);
    return null;
  }
  return (data?.value ?? "stewards") === "stewards";
}

/** Whether members may put up and manage their own giving links; a failed read gives the default. */
export async function givingStewardsCanManage(
  supabase: SupabaseClient,
  orgId: string
): Promise<boolean> {
  return (await readStewardsCanManage(supabase, orgId)) ?? true;
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

type PickerProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
  role: string;
  is_unlisted: boolean;
};

function byLastThenFirstName(a: PickerProfile, b: PickerProfile): number {
  return (
    (a.last_name ?? "").localeCompare(b.last_name ?? "") ||
    (a.first_name ?? "").localeCompare(b.first_name ?? "")
  );
}

/**
 * Picker options for a fund: the group's current members, whoever is asking, so
 * a church admin or an open directory doesn't widen them. `failed` tells an empty
 * list from a failed read. A null embed is a profile RLS hides from the viewer,
 * and a pending person can't be named on anything. An unlisted person stays out
 * even for a viewer who can read them: Give drops a fund whose recipient members
 * can't read.
 */
export async function loadFundFormData(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string
): Promise<{
  members: MemberOption[];
  failed: boolean;
}> {
  const memberships = readList<{ profiles: PickerProfile | null }>(
    await supabase
      .from("group_members")
      .select("profiles(id, first_name, last_name, preferred_name, avatar_url, role, is_unlisted)")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .returns<{ profiles: PickerProfile | null }[]>(),
    "fund form members"
  );
  if (memberships === null) return { members: [], failed: true };

  const rows = memberships
    .flatMap((m) =>
      m.profiles && m.profiles.role !== "pending" && !m.profiles.is_unlisted ? [m.profiles] : []
    )
    .sort(byLastThenFirstName);

  return { members: await toMemberOptions(rows), failed: false };
}

/**
 * Everyone the viewer's directory shows, for the prayer call card. A fund's
 * pickers use loadFundFormData, which is limited to the fund's group.
 */
export async function loadDirectoryMemberOptions(
  supabase: SupabaseClient,
  orgId: string
): Promise<{
  members: MemberOption[];
  failed: boolean;
}> {
  const rows = readList(
    await supabase
      .from("profiles_directory")
      .select("id, first_name, last_name, preferred_name, avatar_url")
      .eq("org_id", orgId)
      .order("last_name")
      .order("first_name"),
    "directory members"
  );
  if (rows === null) return { members: [], failed: true };
  return { members: await toMemberOptions(rows), failed: false };
}

// Private buckets: exchange stored avatar URLs for signed URLs before they reach
// the pickers. Signing goes through lib/storageRead's own cookie-bound client,
// never the caller's `supabase` parameter: a passed-in client is untyped as to
// privilege (Tier C).
async function toMemberOptions(rows: Omit<PickerProfile, "role" | "is_unlisted">[]): Promise<MemberOption[]> {
  const signedAvatars = await mintSignedUrls(rows.map((p) => p.avatar_url));
  return rows.map((p, i) => ({
    id: p.id,
    name: displayName(p),
    initials: initials(p),
    avatarUrl: signedAvatars[i],
  }));
}
