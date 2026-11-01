import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { ensureGroupCalendar } from "@/lib/groups/calendar";
import { getGroupMemberships } from "@/lib/groups/server";
import { STORED_MEMBER_ROLES } from "@/lib/roles";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { parseAboutChanges, type LeaderChanges, type LeaderEdit, type LeaderEntry } from "../aboutChanges";

type RequestClient = Awaited<ReturnType<typeof createClient>>;

function failed(what: string, error: unknown) {
  console.error("Failed to save the About page %s:", what, error);
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
}

async function listedLeaders(
  supabase: RequestClient,
  orgId: string,
  groupId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("class_teachers")
    .select("profile_id")
    .eq("org_id", orgId)
    .eq("group_id", groupId);
  if (error) return null;
  return new Set((data ?? []).map((row) => row.profile_id));
}

/** Null when the read failed. */
async function allAreMembers(
  supabase: RequestClient,
  orgId: string,
  groupId: string,
  profileIds: string[],
): Promise<boolean | null> {
  if (profileIds.length === 0) return true;
  const { data, error } = await supabase
    .from("group_members")
    .select("profile_id, profiles!inner(role)")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .in("profile_id", profileIds)
    .in("profiles.role", STORED_MEMBER_ROLES);
  if (error) return null;
  return (data ?? []).length === profileIds.length;
}

/** A blank field on an addition means "nothing entered", not "clear what is saved". */
function filledFields({ profile_id, title, bio }: LeaderEntry): LeaderEdit {
  return { profile_id, ...(title && { title }), ...(bio && { bio }) };
}

/**
 * Touches only the rows and columns this leader changed. An `order` entry
 * another leader has since removed is skipped rather than written back. Someone
 * already listed, because another leader added them or a Save's response was
 * lost, keeps any field this addition left blank. The insert is the Save's last
 * write: a failure before it leaves the person unlisted, so a retry inserts the
 * fields as they then stand, blanks included. Returns the failure response, or
 * null when it all landed.
 */
async function writeLeaders(
  supabase: RequestClient,
  orgId: string,
  groupId: string,
  { added, edited, removed, order }: LeaderChanges,
  listed: Set<string>,
) {
  if (removed.length > 0) {
    // No row count check: a retry finds these already gone.
    const { error } = await supabase
      .from("class_teachers")
      .delete()
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .in("profile_id", removed);
    if (error) return failed("leadership removal", error);
  }

  const update = (profileId: string, fields: Omit<LeaderEdit, "profile_id"> | { sort_order: number }) =>
    supabase
      .from("class_teachers")
      .update(fields)
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .select("id");
  const results = await Promise.all([
    ...[...edited, ...added.filter((l) => listed.has(l.profile_id)).map(filledFields)].flatMap(
      ({ profile_id, ...fields }) => (Object.keys(fields).length > 0 ? [update(profile_id, fields)] : []),
    ),
    ...(order ?? []).flatMap((id, index) => (listed.has(id) ? [update(id, { sort_order: index })] : [])),
  ]);
  // RLS rejecting a write reports zero rows, not an error.
  const failure = results.find(({ data, error }) => error || !data?.length);
  if (failure) return failed("leadership", failure.error);

  const newEntries = added.filter((l) => !listed.has(l.profile_id));
  if (newEntries.length > 0) {
    const { error } = await supabase.from("class_teachers").insert(
      newEntries.map((leader) => ({
        org_id: orgId,
        group_id: groupId,
        profile_id: leader.profile_id,
        title: leader.title,
        bio: leader.bio,
        sort_order: order?.indexOf(leader.profile_id) ?? 0,
      })),
    );
    if (error) return failed("leadership addition", error);
  }

  return null;
}

/**
 * Settings → About's one Save. Writes go through the cookie-bound client, so
 * RLS still applies; this route adds the rule RLS does not express, that a
 * leader can only list members of the group.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The same 404 the page gives, so a non-leader cannot confirm the group exists.
  const memberships = isUuid(groupId) ? await getGroupMemberships() : [];
  const group = memberships.find((m) => m.id === groupId);
  if (!group || group.role !== "leader") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const changes = parseAboutChanges(body);
  if (!changes) return NextResponse.json({ error: "Invalid changes" }, { status: 400 });

  const supabase = await createClient();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile) return failed("profile read", profileError);
  const orgId = profile.org_id;

  // Checked before any write, so a refused Save leaves everything unapplied.
  let listed = new Set<string>();
  if (changes.leaders) {
    const current = await listedLeaders(supabase, orgId, groupId);
    if (!current) return failed("leadership read", "read failed");
    listed = current;
    // Writing the edit would bring back an entry another leader removed.
    if (changes.leaders.edited.some((l) => !listed.has(l.profile_id))) {
      return NextResponse.json({ error: "Entry removed" }, { status: 410 });
    }
    // Someone already listed may have since left the group; only a new entry has to be a member.
    const members = await allAreMembers(
      supabase,
      orgId,
      groupId,
      changes.leaders.added.map((l) => l.profile_id).filter((id) => !listed.has(id)),
    );
    if (members === null) return failed("membership check", "read failed");
    if (!members) return NextResponse.json({ error: "Not a member" }, { status: 409 });
  }

  const stamp = { updated_by: user.id, updated_at: new Date().toISOString() };

  if (changes.summary !== undefined) {
    // RLS rejecting a write reports zero rows, not an error.
    const { data, error } = await supabase
      .from("about_page")
      .upsert({ org_id: orgId, group_id: groupId, body: changes.summary, ...stamp })
      .select("group_id");
    if (error || !data?.length) return failed("summary", error);
  }

  if (changes.videoCall) {
    const { data, error } = await supabase
      .from("group_settings")
      .upsert({
        org_id: orgId,
        group_id: groupId,
        weekly_zoom_url: changes.videoCall.url || null,
        zoom_meeting_time: changes.videoCall.time || null,
        ...stamp,
      })
      .select("group_id");
    if (error || !data?.length) return failed("video call", error);
  }

  if (changes.color) {
    const calendarId = await ensureGroupCalendar(supabase, orgId, groupId, group.name);
    if (!calendarId) return failed("color", "no calendar");
    const { data, error } = await supabase
      .from("event_calendars")
      .update({ color: changes.color })
      .eq("id", calendarId)
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .select("id");
    if (error || !data?.length) return failed("color", error);
  }

  if (changes.leaders) {
    const failure = await writeLeaders(supabase, orgId, groupId, changes.leaders, listed);
    if (failure) return failure;
  }

  return NextResponse.json({ ok: true });
}
