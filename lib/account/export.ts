/**
 * One person's own data, for their download. Every read is on the service
 * client because the author of an anonymous prayer request isn't readable
 * otherwise, and because memberships and RSVPs outlive the group access that
 * RLS would need to read them. Each chain filters on the org and on this person
 * or the household on their own profile row. Only unclaimed household entries
 * name anyone else, with their details, since nothing records who typed them.
 * Nothing else selected does: no co-attendees of a serving date, no one else's
 * RSVPs, and no one who prayed for a request.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { rowsOf } from "./rows";

const PROFILE_COLUMNS =
  "first_name, last_name, preferred_name, email, phone, phone_mobile, phone_home, phone_work, " +
  "address_line1, address_line2, city, state, postal_code, birth_month, birth_day, birth_year, " +
  "anniversary, occupation, employer, bio, relationship, role, is_unlisted, hide_email, " +
  "email_announcements, created_at";

const HOUSEHOLD_COLUMNS =
  "family_name, address_line1, address_line2, city, state, postal_code, phone_home, " +
  "anniversary_month, anniversary_day, anniversary_year";

const HOUSEHOLD_ENTRY_INTERNALS = new Set([
  "id",
  "family_id",
  "org_id",
  "claimed_profile_id",
  "avatar_url",
  "created_at",
  "updated_at",
]);

// Everything but the internals, not a list of columns, so a column the household
// form stops storing simply stops appearing here.
function householdEntry(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => !HOUSEHOLD_ENTRY_INTERNALS.has(column)),
  );
}

/** Null when the person has no profile in this org. Throws on any failed read, never a partial file. */
export async function buildAccountExport(orgId: string, personId: string) {
  const service = await createServiceClient();

  const [profile] = rowsOf<Record<string, unknown> & { family_id: string | null }>(
    await service
      .from("profiles")
      .select(`${PROFILE_COLUMNS}, family_id`)
      .eq("id", personId)
      .eq("org_id", orgId),
    "profile",
  );
  if (!profile) return null;
  const { family_id: familyId, ...ownProfile } = profile;

  const [groups, teams, rsvps, serving, prayers, funds, feedback, households, entries] = await Promise.all([
    service
      .from("group_members")
      .select("role, joined_at, groups(name)")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    service
      .from("team_members")
      .select("is_leader, assigned_at, teams(name)")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    service
      .from("rsvps")
      .select("status, created_at, events(title, start_time)")
      .eq("org_id", orgId)
      .eq("user_id", personId),
    service
      .from("serving_signup_attendees")
      .select("serving_signups(service_date, teams(name))")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    service
      .from("prayer_requests")
      .select("body, is_anonymous, is_answered, created_at, groups(name)")
      .eq("org_id", orgId)
      .eq("author_id", personId)
      .order("created_at", { ascending: false }),
    service
      .from("giving_funds")
      .select("name, description, is_active, retire_on, groups(name), giving_fund_methods(method, custom_handle)")
      .eq("org_id", orgId)
      .eq("steward_id", personId)
      .order("name"),
    service
      .from("feedback")
      .select("type, message, created_at")
      .eq("org_id", orgId)
      .eq("profile_id", personId)
      .order("created_at", { ascending: false }),
    familyId
      ? service.from("family_units").select(HOUSEHOLD_COLUMNS).eq("id", familyId).eq("org_id", orgId)
      : { data: [], error: null },
    familyId
      ? service
          .from("family_members")
          .select("*")
          .eq("org_id", orgId)
          .eq("family_id", familyId)
          .or(`claimed_profile_id.is.null,claimed_profile_id.eq.${personId}`)
      : { data: [], error: null },
  ]);

  const named = (row: { name?: string } | null | undefined) => row?.name ?? null;

  return {
    profile: ownProfile,
    household: rowsOf<Record<string, unknown>>(households, "household")[0] ?? null,
    household_entries: rowsOf<Record<string, unknown>>(entries, "household entries").map(householdEntry),
    groups: rowsOf<{ role: string; joined_at: string; groups: { name: string } | null }>(
      groups,
      "groups",
    ).map((g) => ({ group: named(g.groups), role: g.role, joined_at: g.joined_at })),
    teams: rowsOf<{ is_leader: boolean; assigned_at: string; teams: { name: string } | null }>(
      teams,
      "teams",
    ).map((t) => ({ team: named(t.teams), is_team_lead: t.is_leader, joined_at: t.assigned_at })),
    rsvps: rowsOf<{
      status: string;
      created_at: string;
      events: { title: string; start_time: string } | null;
    }>(rsvps, "rsvps").map((r) => ({
      event: r.events?.title ?? null,
      event_starts_at: r.events?.start_time ?? null,
      status: r.status,
      answered_at: r.created_at,
    })),
    serving_turns: rowsOf<{
      serving_signups: { service_date: string; teams: { name: string } | null } | null;
    }>(serving, "serving turns").map((s) => ({
      team: named(s.serving_signups?.teams),
      date: s.serving_signups?.service_date ?? null,
    })),
    prayer_requests: rowsOf<{
      body: string;
      is_anonymous: boolean;
      is_answered: boolean;
      created_at: string;
      groups: { name: string } | null;
    }>(prayers, "prayer requests").map((p) => ({
      group: named(p.groups),
      body: p.body,
      anonymous: p.is_anonymous,
      answered: p.is_answered,
      posted_at: p.created_at,
    })),
    funds_you_receive: rowsOf<{
      name: string;
      description: string | null;
      is_active: boolean;
      retire_on: string | null;
      groups: { name: string } | null;
      giving_fund_methods: { method: string; custom_handle: string }[] | null;
    }>(funds, "funds").map((f) => ({
      fund: f.name,
      group: named(f.groups),
      description: f.description,
      active: f.is_active,
      retire_on: f.retire_on,
      payment_methods: (f.giving_fund_methods ?? []).map((m) => ({
        method: m.method,
        handle: m.custom_handle,
      })),
    })),
    feedback: rowsOf<{ type: string; message: string; created_at: string }>(feedback, "feedback").map((f) => ({
      type: f.type,
      message: f.message,
      sent_at: f.created_at,
    })),
  };
}
