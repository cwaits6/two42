/**
 * One person's own data, for their download. Every read is on the service
 * client because memberships and RSVPs outlive the group access that RLS would
 * need to read them, and because an anonymous prayer request is recognised as
 * theirs only by recomputing its author hash over the church's hashed rows,
 * which under a wrong author key matches none of them; a hidden-name comment
 * the same way. Only the person's own comments are included, not others' on
 * their requests. Each chain filters on the org and on this person,
 * their current address, or the household on their own profile row. Only unclaimed
 * household entries name anyone else, with their details, since nothing records
 * who typed them.
 * Nothing else selected does: no co-attendees of a serving date, no one else's
 * RSVPs, and no one who prayed for a request.
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { decryptBody } from "@/lib/prayer/crypto";
import { hashedCommentsOf, type HashedCommentRow } from "@/lib/prayer/commentThread";
import { hashedRequestsOf } from "@/lib/prayer/hashedRequests";
import { loadPrayerKeys } from "@/lib/prayer/keys";
import type { Tables } from "@/lib/supabase/database.types";
import { fetchAll } from "@/lib/supabase/fetchAll";
import { createServiceClient } from "@/lib/supabase/server";
import { rowsOf } from "./rows";

type PrayerRow = Pick<
  Tables<"prayer_requests">,
  "id" | "body" | "body_ciphertext" | "author_hash" | "is_anonymous" | "is_answered" | "created_at"
> & { groups: { name: string } | null };

const PROFILE_COLUMNS =
  "first_name, last_name, preferred_name, email, phone, phone_mobile, phone_home, phone_work, " +
  "address_line1, address_line2, city, state, postal_code, birth_month, birth_day, birth_year, " +
  "anniversary, occupation, employer, bio, relationship, role, is_unlisted, hide_email, " +
  "email_announcements, email_event_reminders, email_dinner_club, created_at";

const HOUSEHOLD_COLUMNS =
  "family_name, address_line1, address_line2, city, state, postal_code, phone_home, " +
  "anniversary_month, anniversary_day, anniversary_year";

const HOUSEHOLD_ENTRY_COLUMNS =
  "first_name, last_name, preferred_name, relationship, birth_month, birth_day, birth_year, is_class_member";

/** Null when the person has no profile in this org. Throws on any failed read, never a partial file. */
export async function buildAccountExport(orgId: string, personId: string) {
  const keys = loadPrayerKeys();
  if (!keys) throw new Error("prayer keys are not configured");
  const service = await createServiceClient();

  const [profile] = rowsOf<Record<string, unknown> & { family_id: string | null; email: string | null }>(
    await service
      .from("profiles")
      .select(`${PROFILE_COLUMNS}, family_id`)
      .eq("id", personId)
      .eq("org_id", orgId),
    "profile",
  );
  if (!profile) return null;
  const { family_id: familyId, ...ownProfile } = profile;

  const [groups, teams, rsvps, serving, namedPrayers, hashedPrayers, namedComments, hiddenComments, funds, feedback, households, entries, groupRequests, accessRequests, dinnerParties, dinnerReplies] = await Promise.all([
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
      .select("status, occurrence_date, created_at, events(title, start_time)")
      .eq("org_id", orgId)
      .eq("user_id", personId),
    service
      .from("serving_signup_attendees")
      .select("serving_signups(service_date, teams(name))")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    // All columns: the app deploys before the migration that adds the sealed
    // columns, and naming one that is missing fails the read.
    service
      .from("prayer_requests")
      .select("*, groups(name)")
      .eq("org_id", orgId)
      .eq("author_id", personId),
    hashedRequestsOf<PrayerRow>(service, orgId, personId, keys, "*, groups(name)"),
    fetchAll<HashedCommentRow, PostgrestError>((from, to) =>
      service
        .from("prayer_comments")
        .select(
          "id, request_id, body_ciphertext, only_asker, hide_name, writer_id, writer_hash, created_at, prayer_requests(groups(name))",
        )
        .eq("org_id", orgId)
        .eq("writer_id", personId)
        .order("id")
        .range(from, to)
        .returns<HashedCommentRow[]>(),
    ),
    hashedCommentsOf(service, orgId, personId, keys),
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
          .select(HOUSEHOLD_ENTRY_COLUMNS)
          .eq("org_id", orgId)
          .eq("family_id", familyId)
          .or(`claimed_profile_id.is.null,claimed_profile_id.eq.${personId}`)
      : { data: [], error: null },
    service
      .from("group_requests")
      .select("name, description, status, created_at")
      .eq("org_id", orgId)
      .eq("requested_by", personId)
      .order("created_at", { ascending: false }),
    // Their current address only. A request at an address they have left may be
    // someone else's, and nothing records whose.
    profile.email
      ? service
          .from("access_requests")
          .select("message, status, created_at")
          .eq("org_id", orgId)
          .ilike("email", profile.email.replace(/[\\%_]/g, "\\$&"))
          .not("message", "is", null)
          .order("created_at", { ascending: false })
      : { data: [], error: null },
    // Their own party's answers; a partner's name is theirs, not this person's.
    service
      .from("dinner_party_members")
      .select(
        "dinner_parties(status, can_host, seats, kids_welcome, access_notes, pets, dinner_seasons(title), dinner_party_addresses(address_line1, address_line2, city, state, postal_code), dinner_party_notes(food_notes))",
      )
      .eq("org_id", orgId)
      .eq("profile_id", personId),
    service
      .from("dinner_replies")
      .select("status, updated_at, dinners(starts_at)")
      .eq("org_id", orgId)
      .eq("profile_id", personId),
  ]);

  const named = (row: { name?: string } | null | undefined) => row?.name ?? null;
  const prayers = [
    ...rowsOf<PrayerRow>(namedPrayers, "prayer requests"),
    ...rowsOf<PrayerRow>(hashedPrayers, "anonymous prayer requests"),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const comments = [
    ...rowsOf<HashedCommentRow>(namedComments, "prayer comments"),
    ...rowsOf<HashedCommentRow>(hiddenComments, "hidden-name prayer comments"),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    profile: ownProfile,
    household: rowsOf<Record<string, unknown>>(households, "household")[0] ?? null,
    household_entries: rowsOf<Record<string, unknown>>(entries, "household entries"),
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
      occurrence_date: string;
      created_at: string;
      events: { title: string; start_time: string } | null;
    }>(rsvps, "rsvps").map((r) => ({
      event: r.events?.title ?? null,
      event_starts_at: r.events?.start_time ?? null,
      date: r.occurrence_date,
      status: r.status,
      answered_at: r.created_at,
    })),
    dinner_club_sign_ups: rowsOf<{
      dinner_parties: {
        status: string;
        can_host: boolean;
        seats: number | null;
        kids_welcome: boolean | null;
        access_notes: string | null;
        pets: string | null;
        dinner_seasons: { title: string } | null;
        dinner_party_addresses: Record<string, unknown> | null;
        dinner_party_notes: { food_notes: string } | null;
      } | null;
    }>(dinnerParties, "dinner club sign-ups").map(({ dinner_parties: p }) => ({
      season: p?.dinner_seasons?.title ?? null,
      status: p?.status ?? null,
      can_host: p?.can_host ?? null,
      seats: p?.seats ?? null,
      kids_welcome: p?.kids_welcome ?? null,
      access_notes: p?.access_notes ?? null,
      pets: p?.pets ?? null,
      address: p?.dinner_party_addresses ?? null,
      food_notes: p?.dinner_party_notes?.food_notes ?? null,
    })),
    dinner_club_replies: rowsOf<{ status: string; updated_at: string; dinners: { starts_at: string } | null }>(
      dinnerReplies,
      "dinner club replies",
    ).map((r) => ({ dinner_starts_at: r.dinners?.starts_at ?? null, status: r.status, answered_at: r.updated_at })),
    serving_turns: rowsOf<{
      serving_signups: { service_date: string; teams: { name: string } | null } | null;
    }>(serving, "serving turns").map((s) => ({
      team: named(s.serving_signups?.teams),
      date: s.serving_signups?.service_date ?? null,
    })),
    prayer_requests: prayers.map((p) => ({
      group: named(p.groups),
      body: p.body_ciphertext ? decryptBody(keys, orgId, p.id, p.body_ciphertext) : p.body,
      anonymous: p.is_anonymous,
      answered: p.is_answered,
      posted_at: p.created_at,
    })),
    prayer_comments: comments.map((c) => ({
      group: named(c.prayer_requests?.groups),
      body: decryptBody(keys, orgId, c.id, c.body_ciphertext),
      only_the_person_who_asked: c.only_asker,
      name_hidden: c.hide_name,
      posted_at: c.created_at,
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
    group_requests: rowsOf<{ name: string; description: string | null; status: string; created_at: string }>(
      groupRequests,
      "group requests",
    ).map((r) => ({ name: r.name, description: r.description, status: r.status, requested_at: r.created_at })),
    access_requests: rowsOf<{ message: string; status: string; created_at: string }>(
      accessRequests,
      "access requests",
    ).map((r) => ({ message: r.message, status: r.status, sent_at: r.created_at })),
  };
}
