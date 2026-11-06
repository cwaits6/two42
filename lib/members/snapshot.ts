/**
 * Org roster snapshot. The ONLY module under lib/members/ that
 * touches IO. It takes the cookie-bound request client as a parameter and
 * never constructs one, so the pure modules (csv/format/import-plan) stay
 * importable in vitest's node environment and this file never pulls
 * next/headers into a shared graph.
 *
 * Tenancy: RLS is still the boundary — every table below carries the
 * restrictive `org isolation` policy, and today's two callers both hand in
 * the cookie-bound request client, which RLS already narrows to the caller's
 * org. The explicit .eq("org_id", orgId) is not that boundary; it is the
 * tier-C floor for the caller this signature cannot refuse. A
 * `SupabaseClient<Database>` PARAMETER is untyped as to privilege: a
 * service-role client satisfies it identically and carries BYPASSRLS, at
 * which point all six selects become a full-table read of every org's
 * roster. Contrast lib/members/access.ts, which makes the same argument
 * correctly because it CONSTRUCTS its client and can therefore guarantee it.
 *
 * `orgId` must come from a validated anchor — requireOrgAdmin() reads it off
 * the caller's own RLS-scoped profile row. Never off a request body.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { toUserRole } from "@/lib/roles";
import { logError } from "@/lib/log";

export interface SnapshotProfile {
  id: string;
  email: string | null;
  role: string;
  relationship: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  phone_mobile: string | null;
  phone_home: string | null;
  phone_work: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  occupation: string | null;
  employer: string | null;
  family_id: string | null;
  is_unlisted: boolean;
  email_announcements: boolean;
  hide_email: boolean;
}

export interface SnapshotFamily {
  id: string;
  family_name: string;
  anniversary_month: number | null;
  anniversary_day: number | null;
  anniversary_year: number | null;
}

export interface SnapshotFamilyMember {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string | null;
  preferred_name: string | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  relationship: string;
  is_class_member: boolean;
  claimed_profile_id: string | null;
}

export interface SnapshotGroup {
  id: string;
  name: string;
}

export interface SnapshotProfileGroup {
  profile_id: string;
  group_id: string;
  is_leader: boolean;
}

/** Plain-data view of the org's roster — no Supabase types leak past here. */
export interface OrgSnapshot {
  profiles: SnapshotProfile[];
  families: SnapshotFamily[];
  familyMembers: SnapshotFamilyMember[];
  groups: SnapshotGroup[];
  profileGroups: SnapshotProfileGroup[];
  /** Lowercased emails with an existing access_request (any status), so the
   *  planner can skip re-inviting — the same dedupe invite-bulk performs. */
  accessRequestEmails: string[];
}

// Single string literals (not concatenations) so supabase-js can parse the
// column list at the type level instead of degrading to GenericStringError.
const PROFILE_COLUMNS =
  "id, role, relationship, first_name, last_name, preferred_name, phone_mobile, phone_home, phone_work, birth_month, birth_day, birth_year, address_line1, address_line2, city, state, postal_code, occupation, employer, family_id, is_unlisted, email_announcements, hide_email";

const FAMILY_MEMBER_COLUMNS =
  "id, family_id, first_name, last_name, preferred_name, birth_month, birth_day, birth_year, relationship, is_class_member, claimed_profile_id";

/**
 * Load one org's roster. Throws on any query error with a message naming the
 * table only — never row content (PII stays out of logs).
 *
 * `emails` is each person's address by profile id, from the caller's
 * admin_member_emails() read, since profiles.email is not read on the
 * request client.
 */
export async function loadOrgSnapshot(
  supabase: SupabaseClient<Database>,
  orgId: string,
  emails: ReadonlyMap<string, string | null>
): Promise<OrgSnapshot> {
  const [profiles, families, familyMembers, groups, profileGroups, requests] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(PROFILE_COLUMNS)
        .eq("org_id", orgId)
        .order("id"),
      supabase
        .from("family_units")
        .select("id, family_name, anniversary_month, anniversary_day, anniversary_year")
        .eq("org_id", orgId)
        .order("id"),
      supabase
        .from("family_members")
        .select(FAMILY_MEMBER_COLUMNS)
        .eq("org_id", orgId)
        .order("id"),
      supabase
        .from("teams")
        .select("id, name")
        .eq("org_id", orgId)
        .order("id"),
      supabase
        .from("team_members")
        .select("profile_id, team_id, is_leader")
        .eq("org_id", orgId)
        .order("profile_id"),
      supabase
        .from("access_requests")
        .select("email")
        .eq("org_id", orgId)
        .order("id"),
    ]);

  if (profiles.error) logError("Member snapshot read failed", profiles.error, { step: "profiles", ids: { org: orgId } });
  if (profiles.error) throw new Error("Failed to load profiles");
  if (families.error) logError("Member snapshot read failed", families.error, { step: "family_units", ids: { org: orgId } });
  if (families.error) throw new Error("Failed to load family_units");
  if (familyMembers.error) logError("Member snapshot read failed", familyMembers.error, { step: "family_members", ids: { org: orgId } });
  if (familyMembers.error) throw new Error("Failed to load family_members");
  if (groups.error) logError("Member snapshot read failed", groups.error, { step: "teams", ids: { org: orgId } });
  if (groups.error) throw new Error("Failed to load teams");
  if (profileGroups.error) logError("Member snapshot read failed", profileGroups.error, { step: "team_members", ids: { org: orgId } });
  if (profileGroups.error) throw new Error("Failed to load team_members");
  if (requests.error) logError("Member snapshot read failed", requests.error, { step: "access_requests", ids: { org: orgId } });
  if (requests.error) throw new Error("Failed to load access_requests");
  // The two reads are separate, so a person added between them has no entry. Treating that as
  // no address would drop it from an export and leave its login row unmatched on import.
  if ((profiles.data ?? []).some((p) => !emails.has(p.id))) throw new Error("Failed to load member emails");

  return {
    profiles: (profiles.data ?? []).map((p) => ({
      ...p,
      email: emails.get(p.id) ?? null,
      role: toUserRole(p.role),
    })),
    families: families.data ?? [],
    familyMembers: familyMembers.data ?? [],
    groups: groups.data ?? [],
    // The planner's shape predates the team rename and keys memberships by
    // group_id; the column is team_members.team_id.
    profileGroups: (profileGroups.data ?? []).map(({ team_id, ...row }) => ({
      ...row,
      group_id: team_id,
    })),
    accessRequestEmails: (requests.data ?? []).map((r) =>
      r.email.trim().toLowerCase()
    ),
  };
}
