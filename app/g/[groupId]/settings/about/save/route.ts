import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { ensureGroupCalendar } from "@/lib/groups/calendar";
import { getGroupMemberships } from "@/lib/groups/server";
import { STORED_MEMBER_ROLES } from "@/lib/roles";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { parseAboutChanges } from "../aboutChanges";

type RequestClient = Awaited<ReturnType<typeof createClient>>;

function failed(what: string, error: unknown) {
  console.error("Failed to save the About page %s:", what, error);
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
}

/**
 * Only someone new to the list has to be a current member: an entry that
 * predates that rule, or whose person has since left the group, stays
 * editable until a leader removes it. Null when a read failed.
 */
async function hasAddedNonMember(
  supabase: RequestClient,
  orgId: string,
  groupId: string,
  profileIds: string[],
): Promise<boolean | null> {
  const { data: listed, error: listedError } = await supabase
    .from("class_teachers")
    .select("profile_id")
    .eq("org_id", orgId)
    .eq("group_id", groupId);
  if (listedError) return null;
  const alreadyListed = new Set((listed ?? []).map((row) => row.profile_id));
  const added = profileIds.filter((id) => !alreadyListed.has(id));
  if (added.length === 0) return false;

  const { data: members, error: membersError } = await supabase
    .from("group_members")
    .select("profile_id, profiles!inner(role)")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .in("profile_id", added)
    .in("profiles.role", STORED_MEMBER_ROLES);
  if (membersError) return null;
  return (members ?? []).length !== added.length;
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

  // Checked before any write, so a refused person leaves the whole Save unapplied.
  if (changes.leaders) {
    const refused = await hasAddedNonMember(
      supabase,
      orgId,
      groupId,
      changes.leaders.list.map((l) => l.profile_id),
    );
    if (refused === null) return failed("membership check", "read failed");
    if (refused) return NextResponse.json({ error: "Not a member" }, { status: 409 });
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
    const { list, removed } = changes.leaders;
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
    if (list.length > 0) {
      const { data, error } = await supabase
        .from("class_teachers")
        .upsert(
          list.map((leader, index) => ({
            org_id: orgId,
            group_id: groupId,
            profile_id: leader.profile_id,
            title: leader.title,
            bio: leader.bio,
            sort_order: index,
          })),
          { onConflict: "group_id,profile_id" },
        )
        .select("id");
      if (error || data?.length !== list.length) return failed("leadership", error);
    }
  }

  return NextResponse.json({ ok: true });
}
