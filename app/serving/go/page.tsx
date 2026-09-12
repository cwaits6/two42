import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { siteConfig } from "@/lib/config";
import { getServingLinkMode } from "@/lib/serving/config";
import { verifyServingToken } from "@/lib/serving/links";
import { formatServiceDate, isValidServiceDate } from "@/lib/serving/sundays";
import { findSpouse, resolveSignupLabel } from "@/lib/serving/server";
import { LinkActionConfirm } from "@/components/serving/LinkActionConfirm";

export const metadata = { title: `Serving | ${siteConfig.name}` };

/**
 * Landing page for signed serving-email links. Works without a login when
 * link mode is 'signed'. The link itself never performs the action — this
 * page asks for one explicit button press first, so email scanners that
 * prefetch URLs can't sign anyone up or cancel anything.
 */

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8">
        <CardContent className="pt-6">
          <h1 className="font-serif text-3xl text-brand-primary mb-4">{title}</h1>
          <p className="text-lg text-muted-foreground">{body}</p>
          <Link
            href="/serving"
            className="inline-block mt-6 text-brand-primary hover:underline text-lg"
          >
            Go to the serving page
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function ServingLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const payload = token ? verifyServingToken(token) : null;

  if (!token || !payload) {
    return (
      <Message
        title="This link has expired"
        body="No problem — you can sign in to the site and manage your serving Sundays there."
      />
    );
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
  // "expired" with nothing in the logs.
  const { data: group, error: groupError } = await service
    .from("member_groups")
    .select("id, name, org_id")
    .eq("id", payload.g)
    .maybeSingle();

  if (groupError) {
    console.error("Serving link page: group lookup failed for %s:", payload.g, groupError);
    return (
      <Message
        title="Something went wrong"
        body="We couldn't load this link just now. Please try again in a moment, or sign in to the site to manage your serving Sundays."
      />
    );
  }

  if (!group) {
    return (
      <Message
        title="This link has expired"
        body="No problem — you can sign in to the site and manage your serving Sundays there."
      />
    );
  }

  const linkMode = await getServingLinkMode(service, group.org_id);
  if (linkMode === "login") {
    return (
      <Message
        title="Please sign in"
        body="Email links on this site require signing in first. Head to the serving page and we'll take you through login."
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
      .select("id, org_id, first_name, preferred_name, family_id, role")
      .eq("id", payload.p)
      .maybeSingle(),
    service
      .from("serving_team_settings")
      .select("enabled")
      .eq("group_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
    service
      .from("profile_groups")
      .select("profile_id")
      .eq("profile_id", payload.p)
      .eq("group_id", payload.g)
      .eq("org_id", group.org_id)
      .maybeSingle(),
    service
      .from("serving_signups")
      .select(
        "id, family_id, created_by, serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))"
      )
      .eq("group_id", payload.g)
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
    return (
      <Message
        title="Something went wrong"
        body="We couldn't load this link just now. Please try again in a moment, or sign in to the site to manage your serving Sundays."
      />
    );
  }

  if (!profile || profile.role === "pending" || !settings?.enabled) {
    return (
      <Message
        title="This link has expired"
        body="No problem — you can sign in to the site and manage your serving Sundays there."
      />
    );
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
    return (
      <Message
        title="This link has expired"
        body="No problem — you can sign in to the site and manage your serving Sundays there."
      />
    );
  }

  const dateLabel = formatServiceDate(payload.d);
  const firstName = profile.preferred_name || profile.first_name || "Friend";

  if (payload.a === "signup") {
    if (!membership) {
      return (
        <Message
          title="You're no longer on this team"
          body="This signup link is for a team you're not currently part of. Check the serving page for teams available to you."
        />
      );
    }
    if (!isValidServiceDate(payload.d)) {
      return (
        <Message
          title="That Sunday has passed"
          body="This link pointed at a Sunday that's already behind us. Check the serving page for the upcoming schedule."
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
      // resolveSignupLabel is non-fatal: the household name only enriches
      // the "already covered" copy, so a failed read degrades to the
      // attendee names.
      const coveredLabel = await resolveSignupLabel(
        service,
        attendees,
        signup.family_id,
        group.org_id
      );
      return (
        <Message
          title="That Sunday is covered"
          body={`${coveredLabel} already has ${dateLabel} — thank you for offering! Check the serving page for other open Sundays.`}
        />
      );
    }

    // Offer the spouse option when the member has one on file. findSpouse is
    // non-fatal: a failed read degrades to not offering the option rather
    // than blocking the signup.
    let spouseName: string | null = null;
    if (profile.family_id) {
      const spouse = await findSpouse(
        service,
        profile.family_id,
        profile.id,
        group.org_id
      );
      spouseName = spouse ? spouse.preferred_name || spouse.first_name : null;
    }

    return (
      <LinkActionConfirm
        token={token}
        action="signup"
        firstName={firstName}
        teamName={group.name}
        dateLabel={dateLabel}
        spouseName={spouseName}
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
      <Message
        title="Nothing to cancel"
        body={`You're not signed up for ${dateLabel} — it may have been cancelled already.`}
      />
    );
  }

  return (
    <LinkActionConfirm
      token={token}
      action="cancel"
      firstName={firstName}
      teamName={group.name}
      dateLabel={dateLabel}
      spouseName={null}
    />
  );
}
