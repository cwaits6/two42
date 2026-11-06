import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { readList } from "@/lib/supabase/readList";
import { toWallRow } from "@/lib/prayer";
import { todayIn } from "@/lib/serving/dates";
import { dayKey } from "@/lib/time/zone";
import {
  EVENTS_LOOKBACK_MS,
  NEW_WINDOW_MS,
  type AnnouncementRow,
  type AnsweredPrayerRow,
  type DraftRow,
  type GroupHomeReads,
  type LessonRow,
  type RosterRow,
  type ServingSignupRow,
  type ServingTeamRow,
} from "@/lib/groups/groupHome";
import type { DirectoryProfile, Event, FamilyDirectoryFull, Rsvp } from "@/lib/types";

const PRAYER_WALL_COLUMNS =
  "id, group_id, body, is_anonymous, is_answered, created_at, mine, first_name, last_name, preferred_name, avatar_url, praying_count, i_am_praying";

/**
 * Newly answered requests. prayer_wall has no updated_at, so the time comes
 * from prayer_requests and the text and author from the wall, which masks an
 * anonymous author. Editing an answered request moves its time.
 */
async function loadAnsweredPrayers(
  client: SupabaseClient<Database>,
  opts: { orgId: string; groupId: string; since: string },
): Promise<AnsweredPrayerRow[] | null> {
  const { orgId, groupId, since } = opts;
  const answered = readList(
    await client
      .from("prayer_requests")
      .select("id, updated_at")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("is_answered", true)
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(3),
    "answered prayer requests",
  );
  if (!answered) return null;
  if (answered.length === 0) return [];
  const wall = readList(
    await client
      .from("prayer_wall")
      .select(PRAYER_WALL_COLUMNS)
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .in(
        "id",
        answered.map((row) => row.id),
      ),
    "answered prayer text",
  );
  if (!wall) return null;
  const answeredAt = new Map(answered.map((row) => [row.id, row.updated_at]));
  return wall.map((row) => ({
    ...toWallRow(row),
    answered_at: answeredAt.get(row.id ?? "") ?? "",
  }));
}

/**
 * Every read a one-group Home makes, each reporting its own failure as null.
 * The client is a parameter and so untyped as to privilege; every chain
 * carries the caller's validated `orgId`.
 */
export async function loadGroupHomeReads(
  client: SupabaseClient<Database>,
  opts: {
    orgId: string;
    groupId: string;
    isLeader: boolean;
    userId: string;
    timeZone: string;
    now: Date;
  },
): Promise<GroupHomeReads> {
  const { orgId, groupId, isLeader, userId, timeZone, now } = opts;
  const today = todayIn(timeZone, now);
  const nowIso = now.toISOString();
  const eventsSince = new Date(now.getTime() - EVENTS_LOOKBACK_MS).toISOString();
  const newSince = new Date(now.getTime() - NEW_WINDOW_MS);
  const newSinceIso = newSince.toISOString();
  const newSinceDay = dayKey(newSinceIso, timeZone);
  // A set block runs up to a year, so the signups read reaches that far.
  const lastServingDate = new Date(Date.parse(`${today}T00:00:00Z`) + 366 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    events,
    rsvps,
    lessonCount,
    members,
    families,
    roster,
    servingTeams,
    myTeams,
    signups,
    pendingJoinCount,
    drafts,
    lessons,
    announcements,
    answeredPrayers,
    hasOpenPrayer,
    openPrayers,
  ] = await Promise.all([
    client
      .from("events")
      .select("*")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .or(
        `start_time.gte.${eventsSince},` +
          `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${eventsSince}))`,
      )
      .order("start_time", { ascending: true })
      .limit(500)
      .then((read) => readList(read, "Home events") as Event[] | null),
    client
      .from("rsvps")
      .select("*")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .then((read) => readList(read, "the viewer's RSVPs") as Rsvp[] | null),
    // A failed count reads as no lessons, which drops the recording link and the ended panel.
    client
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .then(({ count, error, status }) => {
        // A head read has no body, so the status is the only detail an HTTP failure carries.
        if (error) console.error("Failed to count lessons: code=%s status=%s", error.code, status);
        return count ?? 0;
      }),
    // The Directory's reads and order, so Home's first names match its list.
    client
      .from("profiles_directory")
      .select("*")
      .eq("org_id", orgId)
      .order("last_name", { ascending: true })
      .then((read) => readList(read, "directory people") as DirectoryProfile[] | null),
    client
      .from("families_directory_full")
      .select("*")
      .eq("org_id", orgId)
      .order("family_name", { ascending: true })
      .then((read) => readList(read, "directory households") as unknown as FamilyDirectoryFull[] | null),
    client
      .from("group_members")
      .select("profile_id, joined_at")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .then((read) => readList<RosterRow>(read, "the group's roster")),
    client
      .from("serving_team_settings")
      .select("team_id, schedule, window_weeks, date_from, date_to, teams!inner(name, group_id)")
      .eq("org_id", orgId)
      .eq("enabled", true)
      .eq("teams.group_id", groupId)
      .then((read) => readList(read, "serving team settings") as unknown as ServingTeamRow[] | null),
    client
      .from("team_members")
      .select("team_id, is_leader")
      .eq("org_id", orgId)
      .eq("profile_id", userId)
      .then((read) => readList(read, "the viewer's teams")),
    client
      .from("serving_signups")
      .select("team_id, service_date, teams!inner(name, group_id), serving_signup_attendees(profile_id)")
      .eq("org_id", orgId)
      .eq("teams.group_id", groupId)
      .gte("service_date", today)
      .lte("service_date", lastServingDate)
      .then((read) => readList(read, "upcoming serving dates") as unknown as ServingSignupRow[] | null),
    isLeader
      ? client
          .from("group_join_requests")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("group_id", groupId)
          .eq("status", "pending")
          .then(({ count, error }) => {
            if (error) console.error("Failed to count join requests: code=%s", error.code);
            return error ? null : (count ?? 0);
          })
      : Promise.resolve(0),
    isLeader
      ? client
          .from("announcements")
          .select("id, title")
          .eq("org_id", orgId)
          .eq("group_id", groupId)
          .eq("is_published", false)
          .order("created_at", { ascending: false })
          .then((read) => readList<DraftRow>(read, "draft announcements"))
      : Promise.resolve([] as DraftRow[]),
    client
      .from("lectures")
      .select("id, title, video_url, lecture_date, scripture_reference, created_at")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .or(
        `and(lecture_date.gte.${newSinceDay},lecture_date.lte.${today}),` +
          `and(lecture_date.is.null,created_at.gte.${newSinceIso})`,
      )
      .order("lecture_date", { ascending: false, nullsFirst: true })
      .limit(20)
      .then((read) => readList<LessonRow>(read, "new lessons")),
    // Not limited to the new window: an empty result has to mean the group has none.
    client
      .from("announcements")
      .select("id, title, content, published_at, created_at")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("is_published", true)
      .lte("published_at", nowIso)
      .order("published_at", { ascending: false })
      .limit(3)
      .then((read) => readList<AnnouncementRow>(read, "new announcements")),
    loadAnsweredPrayers(client, { orgId, groupId, since: newSinceIso }),
    client
      .from("prayer_wall")
      .select("id")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("is_answered", false)
      .limit(1)
      .then((read) => {
        const rows = readList(read, "whether the group has a prayer request");
        return rows && rows.length > 0;
      }),
    client
      .from("prayer_wall")
      .select(PRAYER_WALL_COLUMNS)
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .eq("is_answered", false)
      .eq("mine", false)
      .eq("i_am_praying", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .then((read) => readList(read, "Home's prayer request")?.map(toWallRow) ?? null),
  ]);

  return {
    events,
    rsvps,
    lessonCount,
    members,
    families,
    roster,
    servingTeams,
    myTeamIds: myTeams?.map((m) => m.team_id) ?? null,
    myLeadTeamIds: myTeams?.filter((m) => m.is_leader).map((m) => m.team_id) ?? null,
    signups,
    pendingJoinCount,
    drafts,
    lessons,
    announcements,
    answeredPrayers,
    hasOpenPrayer,
    openPrayers,
  };
}
