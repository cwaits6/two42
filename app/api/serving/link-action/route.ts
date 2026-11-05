import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getServingLinkMode } from "@/lib/serving/config";
import { verifyServingToken } from "@/lib/serving/links";
import { bookDates, sendBookingConfirmations } from "@/lib/serving/booking";
import { SIGNUP_SETTINGS_SELECT, isUpcomingServiceDate, teamServiceDates, todayIn } from "@/lib/serving/dates";
import { signupDisplayName } from "@/lib/serving/display";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import {
  findSpouse,
  notifyLeadersOfCancel,
  type NamedProfile,
} from "@/lib/serving/server";
import { logError } from "@/lib/log";

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string"))] : [];
}

/**
 * Executes a signed serving-email action (signup or cancel) without a login
 * session. The HMAC token is the authorization; the /serving/go page collects
 * an explicit button press first so mail scanners never trigger actions.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token: string | undefined = body?.token;
  const includeSpouse: boolean = body?.includeSpouse === true;
  const extraDates = stringList(body?.extraDates);

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

  // org-anchor: the HMAC-validated group row is the org anchor for the signed link
  // The group is fetched first: its org_id is the org anchor for every read
  // and write below (the surface stays on the service-role key, so the org
  // filter is what confines it to one tenant). The profiles
  // read below is a deliberate exception — it stays unscoped so a cross-org
  // pairing is detected and rejected by the explicit check further down,
  // instead of silently matching zero rows.
  // supabase-js does not throw on a failed read — it returns { data: null,
  // error }. Every check below is a truthiness test, so without capturing
  // `error` a 42501, a PostgREST 5xx and a genuinely absent row all render as
  // "this link expired", with nothing in the logs.
  const { data: group, error: groupError } = await service
    .from("teams")
    .select("id, name, org_id, group_id")
    .eq("id", payload.g)
    .maybeSingle();

  if (groupError) {
    logError("Signed-link group lookup failed for group", groupError, { route: "/api/serving/link-action", ids: { group: payload.g } });
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

  const linkMode = await getServingLinkMode(service, group.org_id, group.group_id);
  if (linkMode === "login") {
    return NextResponse.json({ error: "login_required" }, { status: 403 });
  }

  const [
    { data: profile, error: profileError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    // org-anchor: profile org read unscoped so the cross-org pairing check can reject it explicitly
    service
      .from("profiles")
      .select("id, org_id, first_name, last_name, preferred_name, family_id, relationship, email, role")
      .eq("id", payload.p)
      .maybeSingle(),
    service
      .from("serving_team_settings")
      .select(SIGNUP_SETTINGS_SELECT)
      .eq("team_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
  ]);

  if (profileError || settingsError) {
    logError("Signed-link profile/settings lookup failed", profileError ?? settingsError, {
      route: "/api/serving/link-action",
      ids: { profile: payload.p, group: payload.g },
    });
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
    logError("Signed-link cross-org denial: profile org does not match group org", undefined, {
      route: "/api/serving/link-action",
      ids: { profileOrg: profile.org_id, groupOrg: group.org_id, group: payload.g, profile: payload.p },
    });
    return NextResponse.json(
      { error: "This link is no longer valid — please use the site instead" },
      { status: 400 }
    );
  }

  if (payload.a === "signup") {
    const today = todayIn(await orgTimeZoneById(service, group.org_id));
    if (!isUpcomingServiceDate(payload.d, today)) {
      return NextResponse.json(
        { error: "That date has already passed" },
        { status: 400 }
      );
    }
    // The team's dates bound the chosen date and the following weeks alike.
    const teamDates = new Set(teamServiceDates(settings, today));
    if (
      !teamDates.has(payload.d) ||
      !extraDates.every((d) => isUpcomingServiceDate(d, today) && teamDates.has(d) && d > payload.d) ||
      extraDates.length > settings.extra_weeks
    ) {
      return NextResponse.json(
        { error: "That date is not one of the team's dates" },
        { status: 400 }
      );
    }

    // The link acts for a specific member — they must be on the team
    const { data: membership, error: membershipError } = await service
      .from("team_members")
      .select("profile_id")
      .eq("profile_id", profile.id)
      .eq("team_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle();
    if (membershipError) {
      logError("Signed-link membership lookup failed", membershipError, {
        route: "/api/serving/link-action",
        ids: { profile: profile.id, group: payload.g },
      });
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

    const attendees: Array<NamedProfile & { email: string | null }> = [profile];
    if (includeSpouse) {
      // findSpouse is non-fatal: a failed read degrades to signing up the
      // member alone rather than failing the whole action.
      const spouse = await findSpouse(service, profile, group.org_id, payload.g);
      if (spouse) attendees.push(spouse);
    }

    // One RPC per date, one transaction each: the compensating delete this
    // replaces could itself fail, wedging the Sunday behind
    // unique (team_id, service_date). The service-role entry point takes
    // the actor explicitly — there is no session here — and re-derives
    // org_id from the group row, re-asserting the profile↔group pairing the
    // check above already made. `.single()` because `returns table`
    // surfaces through PostgREST as an array; the explicit row type is
    // needed because the server clients are created without a <Database>
    // generic, so `.single()` would otherwise infer `unknown`.
    const outcome = await bookDates([payload.d, ...extraDates], async (date) => {
      // org-anchor: org_id is re-derived and enforced by the RPC itself from the
      // already-validated teams row fetched above
      const { data: rpc, error: rpcError } = await service
        .rpc("serving_signup_apply", {
          _group_id: payload.g,
          _service_date: date,
          _actor_id: profile.id,
          _attendee_ids: attendees.map((a) => a.id),
        })
        .single<{ signup_id: string; signup_org_id: string; created: boolean }>();
      if (rpcError || !rpc) {
        // SV001 is an ordinary race. Everything else is an anomaly the member
        // cannot act on, and it matters more here than on the authenticated
        // route: SV002 and SV003 collapse into one deliberately deniable
        // message below, so the log is the only place that distinction
        // survives.
        if (rpcError?.code !== "SV001") {
          logError("Signed-link signup rpc failed for group", rpcError, {
            route: "/api/serving/link-action",
            ids: { group: payload.g, profile: payload.p },
          });
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
        case "SV006":
          return NextResponse.json(
            { error: "That date is not one of the team's dates" },
            { status: 400 }
          );
      }
      return NextResponse.json({ error: "Failed to sign up" }, { status: 500 });
    }

    await sendBookingConfirmations(service, {
      orgId: group.org_id,
      groupId: group.group_id,
      teamId: payload.g,
      teamName: group.name,
      booked: outcome.booked,
      attendees,
    });

    return NextResponse.json({ success: true, action: "signup", outcome });
  }

  // Cancel: the member must be the signup's creator or one of its attendees
  const { data: signup, error: cancelLookupError } = await service
    .from("serving_signups")
    .select(
      "id, family_id, created_by, serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
    )
    .eq("team_id", payload.g)
    .eq("service_date", payload.d)
    .eq("org_id", group.org_id)
    .maybeSingle();

  // Distinguishing this from the absent-row case matters most here: telling a
  // member their cancellation already happened when the read merely failed
  // makes them stop trying, and the roster is wrong on Sunday.
  if (cancelLookupError) {
    logError("Signed-link cancel lookup failed for group", cancelLookupError, {
      route: "/api/serving/link-action",
      ids: { group: payload.g },
    });
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
      { error: "This date is covered by someone else now" },
      { status: 403 }
    );
  }

  const { error: deleteError } = await service
    .from("serving_signups")
    .delete()
    .eq("id", signup.id)
    .eq("org_id", group.org_id);
  if (deleteError) {
    logError("Signed-link cancel failed", deleteError, { route: "/api/serving/link-action" });
    return NextResponse.json({ error: "Failed to cancel" }, { status: 500 });
  }

  try {
    await notifyLeadersOfCancel(service, {
      groupId: group.group_id,
      teamId: payload.g,
      orgId: group.org_id,
      teamName: group.name,
      serviceDates: [payload.d],
      memberLabel: signupDisplayName(attendeeProfiles),
      excludeProfileId: profile.id,
    });
  } catch (err) {
    logError("Serving cancel notice failed", err, { route: "/api/serving/link-action" });
  }

  return NextResponse.json({ success: true, action: "cancel" });
}
