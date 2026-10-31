import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { displayName } from "@/lib/names";
import { STORED_MEMBER_ROLES } from "@/lib/roles";

type Client = SupabaseClient<Database>;

export interface LeaderPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

/** One group's people as the leaders dialog needs them. */
export interface LeaderRoster {
  /** Everyone in the church directory the admin can name, sorted by name. */
  people: LeaderPerson[];
  /** profile_id → the person's role in this group, for current members only. */
  roles: ReadonlyMap<string, "leader" | "member">;
}

export interface Candidate {
  person: LeaderPerson;
  inGroup: boolean;
}

const UNIQUE_VIOLATION = "23505";

function sortKey(p: LeaderPerson): string {
  return `${p.last_name ?? ""} ${p.first_name ?? ""}`.trim();
}

/** By last name, then first; a profile with no name at all sorts last. */
function byName(a: LeaderPerson, b: LeaderPerson): number {
  const [ka, kb] = [sortKey(a), sortKey(b)];
  if (!ka || !kb) return Number(!ka) - Number(!kb);
  return ka.localeCompare(kb);
}

export function leadersOf(roster: LeaderRoster): LeaderPerson[] {
  return roster.people.filter((p) => roster.roles.get(p.id) === "leader");
}

/**
 * Everyone who could be named a leader: the group's own members first, then
 * the rest of the directory, narrowed by a name search.
 */
export function leaderCandidates(roster: LeaderRoster, query: string): Candidate[] {
  const q = query.trim().toLowerCase();
  const matches = (p: LeaderPerson) =>
    !q ||
    [p.first_name, p.last_name, p.preferred_name, displayName(p)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  const candidates = roster.people
    .filter((p) => roster.roles.get(p.id) !== "leader" && matches(p))
    .map((person) => ({ person, inGroup: roster.roles.has(person.id) }));
  return [...candidates.filter((c) => c.inGroup), ...candidates.filter((c) => !c.inGroup)];
}

/**
 * The group's memberships and the approved people in the directory, both
 * read through the caller's cookie-bound client, so RLS scopes them to the
 * church admin's own org. Null when either read fails.
 */
export async function loadLeaderRoster(client: Client, groupId: string): Promise<LeaderRoster | null> {
  const [members, people] = await Promise.all([
    fetchAll((from, to) =>
      client
        .from("group_members")
        .select("profile_id, role")
        .eq("group_id", groupId)
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      client
        .from("profiles")
        .select("id, first_name, last_name, preferred_name")
        .in("role", STORED_MEMBER_ROLES)
        .order("id")
        .range(from, to),
    ),
  ]);
  if (members.error || people.error) {
    console.error("Failed to load group leaders:", members.error ?? people.error);
    return null;
  }
  const roles = new Map<string, "leader" | "member">(
    (members.data ?? []).map((m) => [m.profile_id, m.role === "leader" ? "leader" : "member"]),
  );
  return { people: [...(people.data ?? [])].sort(byName), roles };
}

/**
 * Make someone a leader of the group. A current member is promoted in place;
 * anyone else from the directory joins the group as a leader. The insert
 * names no org_id: the column DEFAULT resolves the caller's own org and the
 * RLS WITH CHECK pins it there. Every write selects the rows it touched,
 * because a write RLS filters to nothing reports success. Resolves to an
 * error message to show, or null on success.
 */
export async function addLeader(
  client: Client,
  groupId: string,
  profileId: string,
  inGroup: boolean,
): Promise<string | null> {
  if (inGroup) {
    const { data, error } = await client
      .from("group_members")
      .update({ role: "leader" })
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .select("id");
    if (error || !data?.length) return "Couldn't make them a leader. Reload the page and try again.";
    return null;
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  const { data, error } = await client
    .from("group_members")
    .insert({ group_id: groupId, profile_id: profileId, role: "leader", added_by: user?.id ?? null })
    .select("id");
  if (error?.code === UNIQUE_VIOLATION) {
    return "They joined this group a moment ago. Reload the page and try again.";
  }
  if (error || !data?.length) return "Couldn't add them as a leader. Reload the page and try again.";
  return null;
}

/** Take someone off the group's leaders; they stay in the group as a member. */
export async function removeLeader(
  client: Client,
  groupId: string,
  profileId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("group_members")
    .update({ role: "member" })
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("role", "leader")
    .select("id");
  if (error || !data?.length) return "Couldn't remove them as a leader. Reload the page and try again.";
  return null;
}
