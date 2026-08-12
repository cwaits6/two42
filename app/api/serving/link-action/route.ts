import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/names";
import { getServingLinkMode } from "@/lib/serving/config";
import { verifyServingToken } from "@/lib/serving/links";
import { isValidServiceDate } from "@/lib/serving/sundays";
import {
  findSpouse,
  notifyLeadersOfCancel,
  resolveSignupLabel,
  sendSignupConfirmation,
  type NamedProfile,
} from "@/lib/serving/server";

/**
 * Executes a signed serving-email action (signup or cancel) without a login
 * session. The HMAC token is the authorization; the /serving/go page collects
 * an explicit button press first so mail scanners never trigger actions.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token: string | undefined = body?.token;
  const includeSpouse: boolean = body?.includeSpouse === true;

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const payload = verifyServingToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: "This link is no longer valid — please use the site instead" },
      { status: 400 }
    );
  }

  const service = await createServiceClient();

  // The group is fetched first: its org_id is the org anchor for every read
  // and write below (Phase 3, CWA-10 — the surface stays on the service-role
  // key, so the org filter is what confines it to one tenant). The profiles
  // read below is a deliberate exception — it stays unscoped so a cross-org
  // pairing is detected and rejected by the explicit check further down,
  // instead of silently matching zero rows.
  // supabase-js does not throw on a failed read — it returns { data: null,
  // error }. Every check below is a truthiness test, so without capturing
  // `error` a 42501, a PostgREST 5xx and a genuinely absent row all render as
  // "this link expired", with nothing in the logs.
  const { data: group, error: groupError } = await service
    .from("member_groups")
    .select("id, name, org_id")
    .eq("id", payload.g)
    .maybeSingle();

  if (groupError) {
    console.error("Signed-link group lookup failed for group %s:", payload.g, groupError);
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  if (!group) {
    return NextResponse.json(
      { error: "This link is no longer valid — please use the site instead" },
      { status: 400 }
    );
  }

  const linkMode = await getServingLinkMode(service, group.org_id);
  if (linkMode === "login") {
    return NextResponse.json({ error: "login_required" }, { status: 403 });
  }

  const [
    { data: profile, error: profileError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    service
      .from("profiles")
      .select("id, org_id, first_name, last_name, preferred_name, family_id, email, role")
      .eq("id", payload.p)
      .maybeSingle(),
    service
      .from("serving_team_settings")
      .select("enabled")
      .eq("group_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
  ]);

  if (profileError || settingsError) {
    console.error(
      "Signed-link profile/settings lookup failed for profile %s, group %s:",
      payload.p,
      payload.g,
      profileError ?? settingsError
    );
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  if (!profile || profile.role === "pending" || !settings?.enabled) {
    return NextResponse.json(
      { error: "This link is no longer valid — please use the site instead" },
      { status: 400 }
    );
  }

  // The HMAC covers `g` and `p` as opaque ids; nothing in the signature binds
  // them to the same tenant, so the pairing is asserted here against the two
  // rows. A cross-org pairing gets the same response as any invalid link — a
  // distinguishing message would be an org-existence oracle.
  if (profile.org_id !== group.org_id) {
    console.error(
      "Signed-link cross-org denial: profile org %s does not match group org %s (g=%s, p=%s)",
      profile.org_id,
      group.org_id,
      payload.g,
      payload.p
    );
    return NextResponse.json(
      { error: "This link is no longer valid — please use the site instead" },
      { status: 400 }
    );
  }

  if (payload.a === "signup") {
    if (!isValidServiceDate(payload.d)) {
      return NextResponse.json(
        { error: "That Sunday has already passed" },
        { status: 400 }
      );
    }

    // The link acts for a specific member — they must be on the team
    const { data: membership, error: membershipError } = await service
      .from("profile_groups")
      .select("profile_id")
      .eq("profile_id", profile.id)
      .eq("group_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle();
    if (membershipError) {
      console.error(
        "Signed-link membership lookup failed for profile %s, group %s:",
        profile.id,
        payload.g,
        membershipError
      );
      return NextResponse.json(
        { error: "Something went wrong — please try again" },
        { status: 500 }
      );
    }
    if (!membership) {
      return NextResponse.json(
        { error: "You're no longer on this team — please use the site instead" },
        { status: 403 }
      );
    }

    const attendees: NamedProfile[] = [profile];
    if (includeSpouse && profile.family_id) {
      // findSpouse is non-fatal: a failed read degrades to signing up the
      // member alone rather than failing the whole action.
      const spouse = await findSpouse(
        service,
        profile.family_id,
        profile.id,
        group.org_id
      );
      if (spouse) attendees.push(spouse);
    }

    // One RPC, one transaction (CWA-47 / #313): the compensating delete this
    // replaces could itself fail, wedging the Sunday behind
    // unique (group_id, service_date). The service-role entry point takes
    // the actor explicitly — there is no session here — and re-derives
    // org_id from the group row, re-asserting the profile↔group pairing the
    // check above already made. `.single()` because `returns table`
    // surfaces through PostgREST as an array; the explicit row type is
    // needed because the server clients are created without a <Database>
    // generic, so `.single()` would otherwise infer `unknown`.
    const { data: rpc, error: rpcError } = await service
      .rpc("serving_signup_apply", {
        _group_id: payload.g,
        _service_date: payload.d,
        _actor_id: profile.id,
        _attendee_ids: attendees.map((a) => a.id),
      })
      .single<{ signup_id: string; signup_org_id: string; created: boolean }>();

    if (rpcError || !rpc) {
      // SV001 is an ordinary race. Everything else is an anomaly the member
      // cannot act on, and it matters more here than on the authenticated
      // route: SV002 and SV003 collapse into one deliberately deniable message
      // below, so the log is the only place that distinction survives.
      if (rpcError?.code !== "SV001") {
        console.error(
          "Signed-link signup rpc failed for group %s (profile %s, data=%s):",
          payload.g,
          payload.p,
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
        case "SV003":
          // Same generic copy as every other invalid-link outcome — a
          // distinguishing message would be an org-existence oracle.
          return NextResponse.json(
            { error: "This link is no longer valid — please use the site instead" },
            { status: 400 }
          );
        case "SV004":
          return NextResponse.json(
            { error: "You're no longer on this team — please use the site instead" },
            { status: 403 }
          );
      }
      return NextResponse.json({ error: "Failed to sign up" }, { status: 500 });
    }

    // Same created guard as the authenticated route. This is the surface where
    // a double tap is most likely — /serving/go is a one-button page reached
    // from an email, and LinkActionConfirm has no in-flight guard.
    if (rpc.created && profile.email) {
      try {
        await sendSignupConfirmation(service, {
          signupId: rpc.signup_id,
          orgId: group.org_id,
          groupId: payload.g,
          groupName: group.name,
          serviceDate: payload.d,
          attendees,
          familyId: profile.family_id,
          recipient: {
            id: profile.id,
            email: profile.email,
            name: displayName(profile),
          },
        });
      } catch (err) {
        console.error("Serving confirmation email failed:", err);
      }
    }

    return NextResponse.json({ success: true, action: "signup" });
  }

  // Cancel: the member must be the signup's creator or one of its attendees
  const { data: signup, error: cancelLookupError } = await service
    .from("serving_signups")
    .select(
      "id, family_id, created_by, serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
    )
    .eq("group_id", payload.g)
    .eq("service_date", payload.d)
    .eq("org_id", group.org_id)
    .maybeSingle();

  // Distinguishing this from the absent-row case matters most here: telling a
  // member their cancellation already happened when the read merely failed
  // makes them stop trying, and the roster is wrong on Sunday.
  if (cancelLookupError) {
    console.error(
      "Signed-link cancel lookup failed for group %s, date %s:",
      payload.g,
      payload.d,
      cancelLookupError
    );
    return NextResponse.json(
      { error: "Something went wrong — please try again" },
      { status: 500 }
    );
  }

  if (!signup) {
    return NextResponse.json(
      { error: "That signup was already cancelled" },
      { status: 404 }
    );
  }

  const attendeeProfiles = (signup.serving_signup_attendees ?? [])
    .map((a: { profiles: unknown }) => a.profiles)
    .filter(Boolean) as NamedProfile[];
  const involved =
    signup.created_by === profile.id ||
    attendeeProfiles.some((a) => a.id === profile.id);
  if (!involved) {
    return NextResponse.json(
      { error: "This Sunday is covered by someone else now" },
      { status: 403 }
    );
  }

  const { error: deleteError } = await service
    .from("serving_signups")
    .delete()
    .eq("id", signup.id)
    .eq("org_id", group.org_id);
  if (deleteError) {
    console.error("Signed-link cancel failed:", deleteError);
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }

  try {
    await notifyLeadersOfCancel(service, {
      groupId: payload.g,
      orgId: group.org_id,
      groupName: group.name,
      serviceDate: payload.d,
      memberLabel: await resolveSignupLabel(
        service,
        attendeeProfiles,
        signup.family_id,
        group.org_id
      ),
      excludeProfileId: profile.id,
    });
  } catch (err) {
    console.error("Serving cancel notice failed:", err);
  }

  return NextResponse.json({ success: true, action: "cancel" });
}
