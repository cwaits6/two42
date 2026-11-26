// The viewer's next supper, for their group's Home. Read on the cookie
// client, where row security already keeps a member to their own party and
// table and gives a host's address only to the guests who may read it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGroupSettings } from "@/lib/groups/settings";
import { logError } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import { readList } from "@/lib/supabase/readList";
import { formatAddress } from "@/lib/supperClub/ics";
import { isReplyStatus, partyName, type ReplyStatus } from "@/lib/supperClub/labels";

export interface NextSupper {
  startsAt: string;
  rotationTitle: string;
  isHost: boolean;
  /** The host's first names; null while the supper has no host. */
  hostNames: string | null;
  address: string | null;
  reply: ReplyStatus | null;
  /** What the viewer's party brings, when the rotation's hosts say. */
  bringing: string | null;
}

/**
 * The viewer's next supper in the group: none when the group's Supper club is
 * off, no rotation is running, or the viewer is at no table with a supper to
 * come. Null when a read failed. The client is a parameter and so untyped as
 * to privilege; `orgId` must be the caller's already-validated org.
 */
export async function loadNextSupper(
  supabase: SupabaseClient<Database>,
  { orgId, groupId, userId, now }: { orgId: string; groupId: string; userId: string; now: Date },
): Promise<{ supper: NextSupper | null } | null> {
  const none = { supper: null };
  try {
    if (!(await getGroupSettings(supabase, orgId, groupId)).supper_club_enabled) return none;
  } catch {
    return null;
  }

  const rotation = readList(
    await supabase
      .from("supper_rotations")
      .select("id, title, bring_list_enabled")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("status", "published")
      .limit(1),
    "Home's Supper club rotation",
  );
  if (!rotation) return null;
  if (!rotation[0]) return none;
  const { id: rotationId, title, bring_list_enabled: bringListOn } = rotation[0];

  const membership = readList(
    await supabase
      .from("supper_party_members")
      .select("party_id")
      .eq("org_id", orgId)
      .eq("rotation_id", rotationId)
      .eq("profile_id", userId)
      .limit(1),
    "Home's Supper club party",
  );
  if (!membership) return null;
  const partyId = membership[0]?.party_id;
  if (!partyId) return none;

  const seats = readList(
    await supabase
      .from("supper_seats")
      .select("table_id")
      .eq("org_id", orgId)
      .eq("party_id", partyId)
      .is("left_at", null),
    "Home's Supper club seats",
  );
  if (!seats) return null;
  if (seats.length === 0) return none;

  const suppers = readList(
    await supabase
      .from("suppers")
      .select("id, starts_at, host_party_id")
      .eq("org_id", orgId)
      .in(
        "table_id",
        seats.map((s) => s.table_id),
      )
      .gt("starts_at", now.toISOString())
      .order("starts_at")
      .limit(1),
    "Home's next supper",
  );
  if (!suppers) return null;
  const supper = suppers[0];
  if (!supper) return none;
  const hostPartyId = supper.host_party_id;
  const isHost = hostPartyId === partyId;

  const [hostMembers, address, replies, contributions] = await Promise.all([
    hostPartyId
      ? supabase.from("supper_party_members").select("profile_id").eq("org_id", orgId).eq("party_id", hostPartyId)
      : Promise.resolve({ data: [], error: null }),
    hostPartyId
      ? supabase
          .from("supper_party_addresses")
          .select("party_id, address_line1, address_line2, city, state, postal_code")
          .eq("org_id", orgId)
          .eq("party_id", hostPartyId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("supper_replies")
      .select("status")
      .eq("org_id", orgId)
      .eq("supper_id", supper.id)
      .eq("profile_id", userId),
    bringListOn && !isHost
      ? supabase
          .from("supper_contributions")
          .select("item")
          .eq("org_id", orgId)
          .eq("supper_id", supper.id)
          .eq("party_id", partyId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const read = {
    hostMembers: readList(hostMembers, "Home's supper host"),
    address: readList(address, "Home's supper address"),
    replies: readList(replies, "Home's supper reply"),
    contributions: readList(contributions, "Home's supper contribution"),
  };
  if (!read.hostMembers || !read.address || !read.replies || !read.contributions) return null;

  let hostNames: string | null = null;
  if (!isHost && read.hostMembers.length > 0) {
    const { data: hosts, error } = await supabase
      .from("profiles")
      .select("id, first_name, preferred_name")
      .eq("org_id", orgId)
      .in(
        "id",
        read.hostMembers.map((m) => m.profile_id),
      );
    if (error) {
      logError("Failed to load the next supper's host names", error);
      return null;
    }
    hostNames =
      partyName((hosts ?? []).map((p) => p.preferred_name?.trim() || p.first_name?.trim() || "").filter(Boolean)) ||
      null;
  }

  const status = read.replies[0]?.status;
  return {
    supper: {
      startsAt: supper.starts_at,
      rotationTitle: title,
      isHost,
      hostNames,
      address: read.address[0] ? formatAddress(read.address[0]) : null,
      reply: status && isReplyStatus(status) ? status : null,
      bringing: read.contributions[0]?.item ?? null,
    },
  };
}
