/**
 * Org roster snapshot (CWA-40). The ONLY module under lib/members/ that
 * touches IO. It takes the cookie-bound request client as a parameter and
 * never constructs one, so the pure modules (csv/format/import-plan) stay
 * importable in vitest's node environment and this file never pulls
 * next/headers into a shared graph.
 *
 * Tenancy: no query here filters on org_id. Every table below carries the
 * restrictive `org isolation` RLS policy, and this client is the cookie-bound
 * request client — RLS already narrows every select to the caller's org.
 * Adding a manual filter would only suggest the filter is the boundary; it
 * is not, RLS is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

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
  anniversary: string | null;
  occupation: string | null;
  employer: string | null;
  family_id: string | null;
  is_unlisted: boolean;
  email_announcements: boolean;
  hide_email: boolean;
  hide_phone_mobile: boolean;
  hide_phone_home: boolean;
  hide_phone_work: boolean;
  hide_address: boolean;
  hide_birthday: boolean;
  hide_birth_year: boolean;
  hide_anniversary: boolean;
  hide_occupation: boolean;
}

export interface SnapshotFamily {
  id: string;
  family_name: string;
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
  "id, email, role, relationship, first_name, last_name, preferred_name, phone_mobile, phone_home, phone_work, birth_month, birth_day, birth_year, address_line1, address_line2, city, state, postal_code, anniversary, occupation, employer, family_id, is_unlisted, email_announcements, hide_email, hide_phone_mobile, hide_phone_home, hide_phone_work, hide_address, hide_birthday, hide_birth_year, hide_anniversary, hide_occupation";

const FAMILY_MEMBER_COLUMNS =
  "id, family_id, first_name, last_name, preferred_name, birth_month, birth_day, birth_year, relationship, is_class_member";

/**
 * Load the caller's org roster through RLS. Throws on any query error with a
 * message naming the table only — never row content (PII stays out of logs).
 */
export async function loadOrgSnapshot(
  supabase: SupabaseClient<Database>
): Promise<OrgSnapshot> {
  const [profiles, families, familyMembers, groups, profileGroups, requests] =
    await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).order("id"),
      supabase.from("family_units").select("id, family_name").order("id"),
      supabase.from("family_members").select(FAMILY_MEMBER_COLUMNS).order("id"),
      supabase.from("member_groups").select("id, name").order("id"),
      supabase
        .from("profile_groups")
        .select("profile_id, group_id, is_leader")
        .order("profile_id"),
      supabase.from("access_requests").select("email").order("id"),
    ]);

  if (profiles.error) throw new Error("Failed to load profiles");
  if (families.error) throw new Error("Failed to load family_units");
  if (familyMembers.error) throw new Error("Failed to load family_members");
  if (groups.error) throw new Error("Failed to load member_groups");
  if (profileGroups.error) throw new Error("Failed to load profile_groups");
  if (requests.error) throw new Error("Failed to load access_requests");

  return {
    profiles: profiles.data ?? [],
    families: families.data ?? [],
    familyMembers: familyMembers.data ?? [],
    groups: groups.data ?? [],
    profileGroups: profileGroups.data ?? [],
    accessRequestEmails: (requests.data ?? []).map((r) =>
      r.email.trim().toLowerCase()
    ),
  };
}
