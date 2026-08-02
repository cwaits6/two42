import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/names";
import { isValidServiceDate } from "@/lib/serving/sundays";
import {
  notifyLeadersOfCancel,
  resolveSignupLabel,
  sendSignupConfirmation,
  type NamedProfile,
} from "@/lib/serving/server";

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
  const attendeeIds: string[] = Array.isArray(body?.attendeeProfileIds)
    ? [...new Set(body.attendeeProfileIds as string[])]
    : [];

  if (!groupId || !serviceDate || attendeeIds.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!isValidServiceDate(serviceDate)) {
    return NextResponse.json(
      { error: "Signups are for upcoming Sundays only" },
      { status: 400 }
    );
  }

  // Team must exist and have serving signups enabled
  const [
    { data: group, error: groupError },
    { data: settings, error: settingsError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    supabase.from("member_groups").select("id, name, org_id").eq("id", groupId).single(),
    supabase
      .from("serving_team_settings")
      .select("enabled")
      .eq("group_id", groupId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, first_name, last_name, preferred_name, family_id")
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
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  if (!group || !settings?.enabled || !profile) {
    return NextResponse.json(
      { error: "Serving signups are not enabled for this team" },
      { status: 404 }
    );
  }

  // Attendees are the signer and optionally their spouse (same household)
  const { data: attendees } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, preferred_name, family_id, relationship")
    .in("id", attendeeIds);

  if (!attendees || attendees.length !== attendeeIds.length) {
    return NextResponse.json({ error: "Unknown attendee" }, { status: 400 });
  }
  for (const a of attendees) {
    const isSelf = a.id === user.id;
    const isSpouse =
      profile.family_id !== null &&
      a.family_id === profile.family_id &&
      ["primary", "spouse"].includes(a.relationship);
    if (!isSelf && !isSpouse) {
      return NextResponse.json(
        { error: "Attendees must be you or your spouse" },
        { status: 400 }
      );
    }
  }

  // One RPC, one transaction: the signup row and its attendee rows commit
  // together or not at all (CWA-47 / #313). The function re-derives org_id
  // from the group row and re-checks authorization itself — SECURITY DEFINER
  // bypasses RLS, so its body is the tenant boundary. `.single()` because
  // `returns table` surfaces through PostgREST as an array; the explicit row
  // type is needed because the server clients are created without a
  // <Database> generic, so `.single()` would otherwise infer `unknown`.
  const { data: rpc, error: rpcError } = await supabase
    .rpc("serving_signup_create", {
      _group_id: groupId,
      _service_date: serviceDate,
      _attendee_ids: attendeeIds,
    })
    .single<{ signup_id: string; signup_org_id: string; created: boolean }>();

  if (rpcError || !rpc) {
    // SV001 is an ordinary race — the expected outcome of two members tapping
    // the same Sunday. Everything else means the app-layer checks above
    // (group, settings, profile, attendees) and the RPC's own checks
    // disagreed, or the request org failed to resolve: anomalies that must not
    // reach the member with no operator signal (CLAUDE.md's app_request_org_id
    // fail-closed rule requires the NULL case be logged). Logged before the
    // switch because every mapped case returns from inside it.
    if (rpcError?.code !== "SV001") {
      console.error(
        "Serving signup rpc failed for group %s (user %s, data=%s):",
        groupId,
        user.id,
        rpc === null ? "null" : "present",
        rpcError
      );
    }
    switch (rpcError?.code) {
      case "SV001":
        return NextResponse.json(
          { error: "Someone just signed up for that Sunday — thank you anyway!" },
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

  // The RPC is additive, so a re-signup succeeds with created = false. Only a
  // freshly claimed Sunday warrants a confirmation; re-sending on an idempotent
  // no-op reads as a double booking (and ships a second ICS for one Sunday).
  if (rpc.created && user.email) {
    try {
      await sendSignupConfirmation(supabase, {
        signupId: rpc.signup_id,
        orgId: group.org_id,
        groupId,
        groupName: group.name,
        serviceDate,
        attendees,
        familyId: profile.family_id,
        recipient: { id: user.id, email: user.email, name: displayName(profile) },
      });
    } catch (err) {
      console.error("Serving confirmation email failed:", err);
    }
  }

  return NextResponse.json({ signup: { id: rpc.signup_id } });
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
      "id, org_id, group_id, service_date, family_id, created_by, member_groups(name), serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
    )
    .eq("id", signupId)
    .maybeSingle();

  // A failed read must surface as a 500, not masquerade as "Signup not
  // found" — the signup may still exist and the member would believe it
  // was cancelled.
  if (signupError) {
    console.error("Serving signup lookup failed for %s:", signupId, signupError);
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }
  if (!signup) {
    return NextResponse.json({ error: "Signup not found" }, { status: 404 });
  }

  // RLS allows deletes only by the signup owner, a leader of the group, or an
  // admin — an empty result means the caller is none of those
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

  try {
    const service = await createServiceClient();
    const groupName =
      (signup.member_groups as unknown as { name: string } | null)?.name ??
      "your team";
    const attendeeProfiles = (signup.serving_signup_attendees ?? [])
      .map((a: { profiles: unknown }) => a.profiles)
      .filter(Boolean) as NamedProfile[];

    // The deleted signup's own org_id scopes the notification lookups — it is
    // the row this route just authorised via the RLS-checked delete above.
    await notifyLeadersOfCancel(service, {
      groupId: signup.group_id,
      orgId: signup.org_id,
      groupName,
      serviceDate: signup.service_date,
      memberLabel: await resolveSignupLabel(
        service,
        attendeeProfiles,
        signup.family_id,
        signup.org_id
      ),
      excludeProfileId: user.id,
    });
  } catch (err) {
    console.error("Serving cancel notice failed:", err);
  }

  return NextResponse.json({ success: true });
}
