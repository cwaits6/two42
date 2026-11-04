import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { bookDates, sendBookingConfirmations } from "@/lib/serving/booking";
import { isUpcomingServiceDate, teamServiceDates, todayIn } from "@/lib/serving/dates";
import { signupDisplayName } from "@/lib/serving/display";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import {
  isCoupleMember,
  notifyLeadersOfCancel,
  type NamedProfile,
} from "@/lib/serving/server";

const SETTINGS_SELECT = "enabled, schedule, window_weeks, date_from, date_to, extra_weeks";

const FAILED = NextResponse.json({ error: "Something went wrong — please try again" }, { status: 500 });

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];
}

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
  const serviceDate: string | undefined = body?.serviceDate;
  const attendeeIds = stringList(body?.attendeeProfileIds);
  const extraDates = stringList(body?.extraDates);

  if (!groupId || !serviceDate || attendeeIds.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const today = todayIn(await getOrgTimeZone());
  if (![serviceDate, ...extraDates].every((d) => isUpcomingServiceDate(d, today))) {
    return NextResponse.json(
      { error: "Signups are for upcoming service dates only" },
      { status: 400 }
    );
  }

  // Team must exist and have serving signups enabled
  const [
    { data: group, error: groupError },
    { data: settings, error: settingsError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, org_id, group_id")
      .eq("id", groupId)
      .single(),
    supabase
      .from("serving_team_settings")
      .select(SETTINGS_SELECT)
      .eq("team_id", groupId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, family_id, relationship")
      .eq("id", user.id)
      .single(),
  ]);

  // A failed read (including an RLS denial) must surface as a 500, not
  // masquerade as "not enabled" (404) below. PGRST116 is .single() finding
  // zero rows — genuinely missing data, which the existing check handles.
  const lookupError = (
    [
      ["group", groupError],
      ["settings", settingsError],
      ["profile", profileError],
    ] as const
  ).find(([, e]) => e && e.code !== "PGRST116");
  if (lookupError) {
    console.error(
      "Serving signup %s lookup failed for group %s:",
      lookupError[0],
      groupId,
      lookupError[1]
    );
    return FAILED;
  }

  if (!group || !settings?.enabled || !profile) {
    return NextResponse.json(
      { error: "Serving signups are not enabled for this team" },
      { status: 404 }
    );
  }

  // The team's dates are the boundary for every date in the request, the
  // chosen one and the following weeks alike; the screens only ever offer
  // dates inside them, so a date outside is a crafted request.
  const teamDates = new Set(teamServiceDates(settings, today));
  if (![serviceDate, ...extraDates].every((d) => teamDates.has(d))) {
    return NextResponse.json({ error: "That date is not one of the team's dates" }, { status: 400 });
  }
  if (extraDates.length > settings.extra_weeks || extraDates.some((d) => d <= serviceDate)) {
    return NextResponse.json({ error: "The team does not ask for those weeks" }, { status: 400 });
  }

  // Attendees are the signer and optionally their spouse: both must be the
  // primary or spouse of the same household.
  const { data: attendees } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, preferred_name, email, family_id, relationship")
    .in("id", attendeeIds);

  if (!attendees || attendees.length !== attendeeIds.length) {
    return NextResponse.json({ error: "Unknown attendee" }, { status: 400 });
  }
  for (const a of attendees) {
    const isSelf = a.id === user.id;
    const isSpouse =
      isCoupleMember(profile) && isCoupleMember(a) && a.family_id === profile.family_id;
    if (!isSelf && !isSpouse) {
      return NextResponse.json(
        { error: "Attendees must be you or your spouse" },
        { status: 400 }
      );
    }
  }

  // One RPC per date, one transaction each: the signup row and its attendee
  // rows commit together or not at all. The function re-derives org_id from
  // the group row and re-checks authorization itself — SECURITY DEFINER
  // bypasses RLS, so its body is the tenant boundary. `.single()` because
  // `returns table` surfaces through PostgREST as an array; the explicit row
  // type is needed because the server clients are created without a
  // <Database> generic, so `.single()` would otherwise infer `unknown`.
  const outcome = await bookDates([serviceDate, ...extraDates], async (date) => {
    const { data: rpc, error: rpcError } = await supabase
      .rpc("serving_signup_create", {
        _group_id: groupId,
        _service_date: date,
        _attendee_ids: attendeeIds,
      })
      .single<{ signup_id: string; signup_org_id: string; created: boolean }>();
    if (rpcError || !rpc) {
      // SV001 is an ordinary race — the expected outcome of two members
      // tapping the same Sunday. Everything else means the app-layer checks
      // above and the RPC's own checks disagreed, or the request org failed
      // to resolve: anomalies that must not reach the member with no operator
      // signal (CLAUDE.md's app_request_org_id fail-closed rule requires the
      // NULL case be logged).
      if (rpcError?.code !== "SV001") {
        console.error(
          "Serving signup rpc failed for group %s on %s (user %s, data=%s):",
          groupId,
          date,
          user.id,
          rpc === null ? "null" : "present",
          rpcError
        );
      }
      return { code: rpcError?.code ?? "failed" };
    }
    return { signupId: rpc.signup_id, created: rpc.created };
  });

  if ("code" in outcome) {
    switch (outcome.code) {
      case "SV001":
        return NextResponse.json(
          { error: "Someone just signed up for that date — thank you anyway!" },
          { status: 409 }
        );
      case "SV002":
        return NextResponse.json({ error: "Unknown attendee" }, { status: 400 });
      case "SV003":
        return NextResponse.json(
          { error: "Serving signups are not enabled for this team" },
          { status: 404 }
        );
      case "SV004":
        return NextResponse.json(
          { error: "You're not on this team" },
          { status: 403 }
        );
    }
    return NextResponse.json({ error: "Failed to sign up" }, { status: 500 });
  }

  await sendBookingConfirmations(supabase, {
    orgId: group.org_id,
    groupId: group.group_id,
    teamId: groupId,
    teamName: group.name,
    booked: outcome.booked,
    attendees,
  });

  return NextResponse.json({ signup: { id: outcome.booked[0].signupId }, ...outcome });
}

/** Switches a date between a couple, one of them, or the other. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const signupId: string | undefined = body?.signupId;
  const attendeeIds = stringList(body?.attendeeProfileIds);
  if (!signupId || attendeeIds.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const { data: signup, error: signupError } = await supabase
    .from("serving_signups")
    .select("id, org_id, team_id, service_date, teams(name, group_id), serving_signup_attendees(profile_id)")
    .eq("id", signupId)
    .maybeSingle();
  if (signupError) {
    console.error("Serving change lookup failed for %s:", signupId, signupError);
    return FAILED;
  }
  if (!signup) {
    return NextResponse.json({ error: "Signup not found" }, { status: 404 });
  }

  // The function re-checks who may change the date and whom they may add,
  // and raises rather than writing anything on a refusal.
  const { data: rpc, error: rpcError } = await supabase
    .rpc("serving_signup_change", { _signup_id: signupId, _attendee_ids: attendeeIds })
    .single<{ added: number; removed: number }>();
  if (rpcError || !rpc) {
    if (rpcError?.code !== "SV005") {
      console.error("Serving change rpc failed for %s (user %s):", signupId, user.id, rpcError);
    }
    switch (rpcError?.code) {
      case "SV005":
        return NextResponse.json({ error: "You're not on this date" }, { status: 403 });
      case "SV002":
        return NextResponse.json({ error: "Attendees must be you or your spouse" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to change who's serving" }, { status: 500 });
  }

  // Whoever was just put on the date gets the confirmation and the calendar
  // invite, the same as at a sign-up.
  const before = new Set((signup.serving_signup_attendees ?? []).map((a) => a.profile_id));
  const team = signup.teams as unknown as { name: string; group_id: string } | null;
  const { data: people } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, preferred_name, email")
    .in("id", attendeeIds);
  const attendees = (people ?? []) as Array<NamedProfile & { email: string | null }>;
  if (team) {
    await sendBookingConfirmations(supabase, {
      orgId: signup.org_id,
      groupId: team.group_id,
      teamId: signup.team_id,
      teamName: team.name,
      booked: [{ date: signup.service_date, signupId: signup.id, created: true }],
      attendees: attendees.filter((a) => !before.has(a.id)),
    });
  }

  return NextResponse.json(rpc);
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const signupId: string | undefined = body?.signupId;
  if (!signupId) {
    return NextResponse.json({ error: "Missing signupId" }, { status: 400 });
  }

  // Capture details before deleting so leaders can be told who freed the slot
  const { data: signup, error: signupError } = await supabase
    .from("serving_signups")
    .select(
      "id, org_id, team_id, service_date, created_by, teams(name, group_id), serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
    )
    .eq("id", signupId)
    .maybeSingle();

  // A failed read must surface as a 500, not masquerade as "Signup not
  // found" — the signup may still exist and the member would believe it
  // was cancelled.
  if (signupError) {
    console.error("Serving signup lookup failed for %s:", signupId, signupError);
    return FAILED;
  }
  if (!signup) {
    return NextResponse.json({ error: "Signup not found" }, { status: 404 });
  }

  // RLS allows deletes only by whoever signed up, anyone listed on the date, the
  // team's lead, or a leader of the group — an empty result means the caller is
  // none of those. The delete cancels the date for everyone on it.
  const { data: deleted, error } = await supabase
    .from("serving_signups")
    .delete()
    .eq("id", signupId)
    .select();

  if (error) {
    console.error("Serving signup delete failed:", error);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The leader notice links into the team's group page, so without the
  // team embed there is no page to point at.
  const team = signup.teams as unknown as { name: string; group_id: string } | null;
  if (!team) {
    console.error("Serving cancel notice skipped — no team for signup %s", signupId);
    return NextResponse.json({ success: true });
  }

  try {
    const service = await createServiceClient();
    const attendeeProfiles = (signup.serving_signup_attendees ?? [])
      .map((a: { profiles: unknown }) => a.profiles)
      .filter(Boolean) as NamedProfile[];

    // The deleted signup's own org_id scopes the notification lookups — it is
    // the row this route just authorised via the RLS-checked delete above.
    await notifyLeadersOfCancel(service, {
      groupId: team.group_id,
      teamId: signup.team_id,
      orgId: signup.org_id,
      teamName: team.name,
      serviceDates: [signup.service_date],
      memberLabel: signupDisplayName(attendeeProfiles),
      excludeProfileId: user.id,
    });
  } catch (err) {
    console.error("Serving cancel notice failed:", err);
  }

  return NextResponse.json({ success: true });
}
