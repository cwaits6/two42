import { createServiceClient } from "@/lib/supabase/server";
import { getServingLinkMode } from "@/lib/serving/config";
import { verifyServingToken } from "@/lib/serving/links";
import {
  SIGNUP_SETTINGS_SELECT,
  formatServingDate,
  isUpcomingServiceDate,
  openDatesAfter,
  teamServiceDates,
  todayIn,
} from "@/lib/serving/dates";
import { signupDisplayName, spouseFirstName } from "@/lib/serving/display";
import { findSpouse } from "@/lib/serving/server";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import { LinkActionConfirm } from "@/components/serving/LinkActionConfirm";
import { ServingNotice } from "@/components/serving/ServingNotice";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Serving");

/**
 * Landing page for signed serving-email links. Works without a login when
 * link mode is 'signed'. The link itself never performs the action — this
 * page asks for one explicit button press first, so email scanners that
 * prefetch URLs can't sign anyone up or cancel anything.
 */

// Every way a link can be invalid — bad signature, expired, a deleted team,
// a removed person, signups turned off, a cross-org pairing — renders this
// one notice, so the page never says which.
const INVALID_LINK = (
  <ServingNotice
    title="This link"
    em="no longer works"
    body="Sign in to see your team's dates and sign up from the site."
  />
);

const LOAD_FAILED = (
  <ServingNotice
    title="Couldn't load"
    em="this link"
    body="Try again in a moment, or sign in to see your team's dates on the site."
  />
);

export default async function ServingLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? verifyServingToken(token) : null;

  if (!token || !payload) {
    return INVALID_LINK;
  }

  const service = await createServiceClient();

  // org-anchor: the HMAC-validated group row is the org anchor for this
  // signed link.
  // The group is fetched first: its org_id is the org anchor for every read
  // below (the surface stays on the service-role key, so the org filter is
  // what confines it to one tenant). The profiles read
  // below is a deliberate exception — it stays unscoped so a cross-org
  // pairing is detected and rejected by the explicit check further down,
  // instead of silently matching zero rows.
  // supabase-js returns { data: null, error } rather than throwing, so an
  // uncaptured error is indistinguishable from an absent row and renders as
  // an invalid link with nothing in the logs.
  const { data: group, error: groupError } = await service
    .from("teams")
    .select("id, name, org_id, group_id")
    .eq("id", payload.g)
    .maybeSingle();

  if (groupError) {
    console.error("Serving link page: group lookup failed for %s:", payload.g, groupError);
    return LOAD_FAILED;
  }

  if (!group) {
    return INVALID_LINK;
  }

  const linkMode = await getServingLinkMode(service, group.org_id, group.group_id);
  if (linkMode === "login") {
    return (
      <ServingNotice
        title="Sign in"
        em="to respond"
        body="This group asks people to sign in before responding to a serving email."
      />
    );
  }

  const [
    { data: profile, error: profileError },
    { data: settings, error: settingsError },
    { data: membership, error: membershipError },
    { data: signup, error: signupError },
  ] = await Promise.all([
    // org-anchor: profile org is read unscoped so the cross-org pairing can
    // be asserted by the explicit profile/group org check below.
    service
      .from("profiles")
      .select("id, org_id, first_name, preferred_name, family_id, relationship, role")
      .eq("id", payload.p)
      .maybeSingle(),
    service
      .from("serving_team_settings")
      .select(SIGNUP_SETTINGS_SELECT)
      .eq("team_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
    service
      .from("team_members")
      .select("profile_id")
      .eq("profile_id", payload.p)
      .eq("team_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
    service
      .from("serving_signups")
      .select(
        "id, family_id, created_by, serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
      )
      .eq("team_id", payload.g)
      .eq("service_date", payload.d)
      .eq("org_id", group.org_id)
      .maybeSingle(),
  ]);

  const loadError = profileError ?? settingsError ?? membershipError ?? signupError;
  if (loadError) {
    console.error(
      "Serving link page: lookup failed for profile %s, group %s, date %s:",
      payload.p,
      payload.g,
      payload.d,
      loadError
    );
    return LOAD_FAILED;
  }

  if (!profile || profile.role === "pending" || !settings?.enabled) {
    return INVALID_LINK;
  }

  // The HMAC covers `g` and `p` as opaque ids; nothing in the signature binds
  // them to the same tenant, so the pairing is asserted here against the two
  // rows. A cross-org pairing renders the same copy as any invalid link — a
  // distinguishing message would be an org-existence oracle.
  if (profile.org_id !== group.org_id) {
    console.error(
      "Serving link page: cross-org denial — profile org %s does not match group org %s (g=%s, p=%s)",
      profile.org_id,
      group.org_id,
      payload.g,
      payload.p
    );
    return INVALID_LINK;
  }

  const today = todayIn(await orgTimeZoneById(service, group.org_id));
  const dateLabel = formatServingDate(payload.d, today);

  if (payload.a === "signup") {
    if (!membership) {
      return (
        <ServingNotice
          title="You're not on"
          em={group.name}
          body="This link is for a team you're not on. The Serving page shows the teams you can sign up with."
        />
      );
    }
    const teamDates = teamServiceDates(settings, today);
    const passed = !isUpcomingServiceDate(payload.d, today);
    if (passed || !teamDates.includes(payload.d)) {
      return (
        <ServingNotice
          title={dateLabel}
          em={passed ? "has passed" : "is not one of the team's dates"}
          body="The Serving page shows the dates that are still open."
        />
      );
    }
    if (signup) {
      const attendees = (signup.serving_signup_attendees ?? [])
        .map((a) => a.profiles as unknown as {
          id: string;
          first_name: string | null;
          last_name: string | null;
          preferred_name: string | null;
        })
        .filter(Boolean);
      const coveredLabel = signupDisplayName(attendees);
      return (
        <ServingNotice
          title={dateLabel}
          em="is covered"
          body={`${coveredLabel} is serving with ${group.name} that day. Thank you for offering. The Serving page shows the dates that are still open.`}
        />
      );
    }

    // Offer the spouse option when the member has one on file. findSpouse is
    // non-fatal: a failed read degrades to not offering the option rather
    // than blocking the signup.
    const spouse = await findSpouse(service, profile, group.org_id, payload.g);

    // The following weeks the team asks about, when they are open. A failed
    // read offers none rather than offering a date that may be taken.
    let extraDates: string[] = [];
    const candidates = teamDates.slice(teamDates.indexOf(payload.d) + 1, teamDates.indexOf(payload.d) + 1 + settings.extra_weeks);
    if (candidates.length > 0) {
      const { data: taken, error: takenError } = await service
        .from("serving_signups")
        .select("service_date")
        .eq("team_id", payload.g)
        .eq("org_id", group.org_id)
        .in("service_date", candidates);
      if (takenError) {
        console.error("Serving link page: following dates lookup failed for group %s:", payload.g, takenError);
      } else {
        const covered = new Set((taken ?? []).map((s) => s.service_date));
        extraDates = openDatesAfter(payload.d, teamDates, (d) => !covered.has(d), settings.extra_weeks);
      }
    }

    return (
      <LinkActionConfirm
        token={token}
        action="signup"
        teamName={group.name}
        date={payload.d}
        today={today}
        spouseName={spouse ? spouseFirstName(spouse) : null}
        extraDates={extraDates}
      />
    );
  }

  // Cancel link
  const isInvolved =
    !!signup &&
    (signup.created_by === profile.id ||
      (signup.serving_signup_attendees ?? []).some(
        (a) => (a.profiles as unknown as { id: string } | null)?.id === profile.id
      ));

  if (!signup || !isInvolved) {
    return (
      <ServingNotice
        title="Nothing"
        em="to cancel"
        body={`You're not signed up for ${dateLabel}. It may have been cancelled already.`}
      />
    );
  }

  return (
    <LinkActionConfirm
      token={token}
      action="cancel"
      teamName={group.name}
      date={payload.d}
      today={today}
      spouseName={null}
      extraDates={[]}
    />
  );
}
