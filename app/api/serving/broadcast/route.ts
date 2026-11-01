import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/names";
import { resolveEmailBranding } from "@/lib/email/identity";
import { getServingLinkMode } from "@/lib/serving/config";
import { createServingToken } from "@/lib/serving/links";
import { todayIn, upcomingServiceDates } from "@/lib/serving/dates";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import { sendServingBroadcastEmail } from "@/lib/email/serving";
import { reserveEmailQuota } from "@/lib/email/quota";
import type { Profile } from "@/lib/types";
import { siteConfig } from "@/lib/config";

/**
 * Leader "Email the team" broadcast: emails every team member the dates
 * that still need someone, each with its own one-tap action link.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const groupId: string | undefined = body?.groupId;
  const message: string | undefined =
    typeof body?.message === "string" ? body.message.trim().slice(0, 1000) : undefined;

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  // The team row comes first: its group_id is what the leadership read
  // below is keyed on. PGRST116 is .single() finding zero rows — a missing
  // team, handled as "not enabled" like the settings check below.
  const { data: group, error: groupError } = await supabase
    .from("teams")
    .select("id, name, org_id, group_id")
    .eq("id", groupId)
    .single();
  if (groupError && groupError.code !== "PGRST116") {
    console.error("Serving broadcast group lookup failed for group %s:", groupId, groupError);
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }
  if (!group) {
    return NextResponse.json(
      { error: "Serving signups are not enabled for this team" },
      { status: 404 }
    );
  }

  const [
    { data: profile, error: profileError },
    { data: teamMembership, error: membershipError },
    { data: groupLeadership, error: leadershipError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name")
      .eq("id", user.id)
      .single(),
    supabase
      .from("team_members")
      .select("is_leader")
      .eq("profile_id", user.id)
      .eq("team_id", groupId)
      .maybeSingle(),
    supabase
      .from("group_members")
      .select("role")
      .eq("group_id", group.group_id)
      .eq("profile_id", user.id)
      .eq("role", "leader")
      .maybeSingle(),
    supabase
      .from("serving_team_settings")
      .select("enabled, window_weeks")
      .eq("team_id", groupId)
      .maybeSingle(),
  ]);

  // A failed read (including an RLS denial) must surface as a 500, not
  // masquerade as "not a leader" (403) or "not enabled" (404) below.
  // PGRST116 is .single() finding zero rows — genuinely missing data, which
  // the existing checks below already handle.
  const lookupError = (
    [
      ["profile", profileError],
      ["membership", membershipError],
      ["leadership", leadershipError],
      ["settings", settingsError],
    ] as const
  ).find(([, e]) => e && e.code !== "PGRST116");
  if (lookupError) {
    console.error(
      "Serving broadcast %s lookup failed for group %s:",
      lookupError[0],
      groupId,
      lookupError[1]
    );
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  const isLeader = teamMembership?.is_leader === true || groupLeadership !== null;
  if (!profile || !isLeader) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!settings?.enabled) {
    return NextResponse.json(
      { error: "Serving signups are not enabled for this team" },
      { status: 404 }
    );
  }

  // Open dates are recomputed here — the email must reflect the truth at
  // send time, not what the leader's page showed when it loaded
  const today = todayIn(await orgTimeZoneById(supabase, group.org_id));
  const dates = upcomingServiceDates(settings.window_weeks, today);
  const { data: signups, error: signupsError } = await supabase
    .from("serving_signups")
    .select("service_date")
    .eq("team_id", groupId)
    .gte("service_date", dates[0])
    .lte("service_date", dates[dates.length - 1]);

  // A failed read here would render every date as open and broadcast
  // signup links for dates that are already covered — fail the send instead.
  if (signupsError) {
    console.error(
      "Serving broadcast signups lookup failed for group %s:",
      groupId,
      signupsError
    );
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  const covered = new Set((signups ?? []).map((s) => s.service_date));
  const openDates = dates.filter((d) => !covered.has(d));

  if (openDates.length === 0) {
    return NextResponse.json(
      { error: "Every upcoming date is covered — nothing to ask for!" },
      { status: 400 }
    );
  }

  const service = await createServiceClient();
  // On the service client so the result is the group's stored choice even
  // when the caller's own RLS view of group_settings is empty; both ids come
  // from the RLS-read team row above.
  const linkMode = await getServingLinkMode(service, group.org_id, group.group_id);
  // Resolved once per broadcast, not per member: an org-level fact anchored
  // on the RLS-checked group row, and a service-role read.
  const branding = await resolveEmailBranding(group.org_id);
  const baseUrl = siteConfig.url;

  // org_id filter is required: the recipient list is the email fan-out
  // surface, so an unscoped service-role read here mails another org's members.
  const { data: memberRows, error: memberRowsError } = await service
    .from("team_members")
    .select(
      "profiles(id, first_name, last_name, preferred_name, email, role, email_announcements)"
    )
    .eq("team_id", groupId)
    .eq("org_id", group.org_id);

  // A failed read here would silently report the team as having no emails on
  // file — fail the send instead of blaming the team's data.
  if (memberRowsError) {
    console.error(
      "Serving broadcast recipient lookup failed for group %s (org=%s):",
      groupId,
      group.org_id,
      memberRowsError
    );
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  const members = (memberRows ?? [])
    .map(
      (r) =>
        r.profiles as unknown as Pick<
          Profile,
          "id" | "first_name" | "last_name" | "preferred_name" | "email" | "role" | "email_announcements"
        > | null
    )
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p?.email && p.role !== "pending" && p.email_announcements !== false
    );

  if (members.length === 0) {
    return NextResponse.json(
      { error: "No team members with email addresses to send to" },
      { status: 400 }
    );
  }

  // Reserve the filtered batch against the org's daily cap before the send
  // loop. Returns before the serving_broadcasts insert below — a
  // cap-hit broadcast must not be logged as a 0-recipient broadcast row.
  const allowed = await reserveEmailQuota(group.org_id, members.length);
  if (!allowed) {
    console.warn(
      "Serving broadcast skipped — org %s hit its daily email cap",
      group.org_id,
    );
    return NextResponse.json(
      { error: "Your organization has reached its daily email limit. Try again tomorrow." },
      { status: 429 },
    );
  }

  const fromName = displayName(profile);
  let sent = 0;
  for (const member of members) {
    const dates = openDates.map((date) => ({
      date,
      url:
        linkMode === "signed"
          ? `${baseUrl}/serving/go?token=${createServingToken({
              a: "signup",
              g: groupId,
              d: date,
              p: member.id,
            })}`
          : `${baseUrl}/g/${group.group_id}/serving/${groupId}`,
    }));

    try {
      await sendServingBroadcastEmail({
        to: member.email!,
        name: member.preferred_name || member.first_name || "Friend",
        teamName: group.name,
        fromName,
        message,
        openDates: dates,
        branding,
      });
      sent++;
    } catch (err) {
      console.error("Serving broadcast failed for member:", member.id, err);
    }
  }

  const { error: logError } = await supabase.from("serving_broadcasts").insert({
    team_id: groupId,
    sent_by: user.id,
    subject: `${group.name}: dates that still need someone`,
    open_dates: openDates,
    recipient_count: sent,
  });
  if (logError) {
    console.error("Failed to log serving broadcast:", logError);
  }

  return NextResponse.json({ sent, openDates });
}
