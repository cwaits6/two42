import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { personName, signupDisplayName } from "@/lib/serving/display";
import { pastServiceDates, todayIn, upcomingServiceDates } from "@/lib/serving/dates";
import {
  ServingSchedule,
  type ScheduleEntry,
} from "@/components/serving/ServingSchedule";
import { ServingHistory, type HistoryEntry } from "@/components/serving/ServingHistory";
import { EmailTeamButton } from "@/components/serving/EmailTeamButton";
import { ServingSettingsDialog } from "@/components/serving/ServingSettingsDialog";
import { TeamDot } from "@/components/serving/TeamDot";
import {
  TeamRoster,
  type TeamRosterMember,
  type TeamRosterPerson,
} from "@/components/serving/TeamRoster";
import { mintSignedUrls } from "@/lib/storageRead";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Serving");

interface AttendeeProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

type RosterProfile = TeamRosterPerson & { role: string };

const byName = (a: TeamRosterPerson, b: TeamRosterPerson) =>
  personName(a).localeCompare(personName(b));

const SIGNUP_SELECT =
  "id, service_date, created_by, family_id, serving_signup_attendees(profiles(id, email, first_name, last_name, preferred_name))";

export default async function ServingSchedulePage({
  params,
}: {
  params: Promise<{ groupId: string; teamId: string }>;
}) {
  const { groupId, teamId } = await params;
  const group = await requireActiveGroup(groupId);
  const servingHref = groupPath(group.id, "/serving");
  const supabase = await createClient();
  const user = await getOptionalUser();

  if (!user) redirect("/login");

  const [{ data: profile }, { data: team }, { data: settings }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, org_id, role, family_id, first_name, last_name, preferred_name")
        .eq("id", user.id)
        .single(),
      supabase
        .from("teams")
        .select("id, name, description, color")
        .eq("id", teamId)
        .eq("group_id", group.id)
        .maybeSingle(),
      supabase
        .from("serving_team_settings")
        .select("*")
        .eq("team_id", teamId)
        .maybeSingle(),
    ]);

  if (!profile || profile.role === "pending") redirect("/dashboard");
  if (!team) notFound();

  const isLeader = group.role === "leader";

  const { data: membership } = await supabase
    .from("team_members")
    .select("is_leader")
    .eq("profile_id", user.id)
    .eq("team_id", teamId)
    .maybeSingle();

  const isMember = !!membership;
  const isTeamLead = membership?.is_leader === true;
  const canManageRoster = isLeader || isTeamLead;
  // A team with signups off is a roster only, so it is reachable only by the
  // people who can change that roster or turn signups on.
  if (!settings?.enabled && !canManageRoster) redirect(servingHref);

  // Everyone can view the schedule/roster read-only; only team members,
  // team leads, and group leaders can actually claim a date.
  const canSignUp = isMember || isTeamLead || isLeader;

  const [{ data: memberRows, error: memberError }, { data: groupRows, error: groupError }] =
    await Promise.all([
      supabase
        .from("team_members")
        .select(
          "is_leader, profiles(id, email, role, first_name, last_name, preferred_name, avatar_url)"
        )
        .eq("team_id", teamId),
      canManageRoster
        ? supabase
            .from("group_members")
            .select("profiles(id, email, role, first_name, last_name, preferred_name, avatar_url)")
            .eq("group_id", group.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
  // A failed read would otherwise render as an empty roster or an empty
  // group, and the add mode's empty-state copy would state that as fact.
  const rosterUnavailable = !!(memberError || groupError);
  if (memberError) console.error("team roster read failed:", memberError.message);
  if (groupError) console.error("team roster group read failed:", groupError.message);
  const memberCount = (memberRows ?? []).filter((row) => {
    const member = row.profiles as unknown as {
      email: string | null;
      role: string;
    } | null;
    return !!member?.email && member.role !== "pending";
  }).length;

  // Pending profiles are household peers who never signed in, not people to
  // put on a team. A null embed is a profile RLS hides from the viewer.
  let rosterMembers: TeamRosterMember[] = [];
  let rosterCandidates: TeamRosterPerson[] = [];
  if (canManageRoster && !rosterUnavailable) {
    const onTeam = new Set<string>();
    for (const row of memberRows ?? []) {
      const p = row.profiles as unknown as RosterProfile | null;
      if (!p) continue;
      onTeam.add(p.id);
      if (p.role === "pending") continue;
      rosterMembers.push({
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        preferred_name: p.preferred_name,
        avatar_url: p.avatar_url,
        is_leader: row.is_leader,
      });
    }
    for (const row of groupRows ?? []) {
      const p = row.profiles as unknown as RosterProfile | null;
      if (!p || p.role === "pending" || onTeam.has(p.id)) continue;
      rosterCandidates.push({
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        preferred_name: p.preferred_name,
        avatar_url: p.avatar_url,
      });
    }
    rosterMembers.sort((a, b) =>
      a.is_leader !== b.is_leader ? (a.is_leader ? -1 : 1) : byName(a, b)
    );
    rosterCandidates.sort(byName);

    // Private buckets: exchange stored avatar URLs for signed URLs.
    const signed = await mintSignedUrls(
      [...rosterMembers, ...rosterCandidates].map((p) => p.avatar_url)
    );
    rosterMembers = rosterMembers.map((p, i) => ({ ...p, avatar_url: signed[i] }));
    rosterCandidates = rosterCandidates.map((p, i) => ({
      ...p,
      avatar_url: signed[rosterMembers.length + i],
    }));
  }

  const today = todayIn(await getOrgTimeZone());
  const dates = upcomingServiceDates(settings?.window_weeks ?? 8, today);

  const [signupRead, pastSignupRead] = await Promise.all([
    supabase
      .from("serving_signups")
      .select(SIGNUP_SELECT)
      .eq("team_id", teamId)
      .gte("service_date", dates[0])
      .lte("service_date", dates[dates.length - 1]),
    supabase
      .from("serving_signups")
      .select(SIGNUP_SELECT)
      .eq("team_id", teamId)
      .lt("service_date", dates[0])
      .order("service_date", { ascending: false }),
  ]);
  const signups = readList(signupRead, "upcoming serving signups");
  const pastSignupRows = readList(pastSignupRead, "past serving signups");
  const scheduleUnavailable = !signups || !pastSignupRows;

  // Household names for couple signups. A failed read degrades the label to
  // the attendees' joined names.
  const familyIds = [
    ...new Set(
      [...(signups ?? []), ...(pastSignupRows ?? [])]
        .filter((s) => (s.serving_signup_attendees?.length ?? 0) > 1 && s.family_id)
        .map((s) => s.family_id as string)
    ),
  ];
  const familyNames = new Map<string, string>();
  if (familyIds.length > 0) {
    const { data: families } = await supabase
      .from("family_units")
      .select("id, family_name")
      .in("id", familyIds);
    for (const f of families ?? []) familyNames.set(f.id, f.family_name);
  }

  const toEntry = (s: NonNullable<typeof signups>[number]): ScheduleEntry => {
    const attendees = (s.serving_signup_attendees ?? [])
      .map((a) => a.profiles as unknown as AttendeeProfile)
      .filter(Boolean);
    return {
      id: s.id,
      date: s.service_date,
      createdBy: s.created_by ?? "",
      attendeeIds: attendees.map((a) => a.id),
      label: signupDisplayName(
        attendees,
        s.family_id ? (familyNames.get(s.family_id) ?? null) : null
      ),
    };
  };

  const entries: Record<string, ScheduleEntry> = Object.fromEntries(
    (signups ?? []).map((s) => [s.service_date, toEntry(s)])
  );
  const pastEntries = new Map((pastSignupRows ?? []).map((s) => [s.service_date, toEntry(s)]));

  // Every past date from the earliest signup on, covered or not
  const earliestPast = pastSignupRows?.at(-1)?.service_date ?? null;
  const historyEntries: HistoryEntry[] = earliestPast
    ? pastServiceDates(earliestPast, today).map((date) => ({
        date,
        entry: pastEntries.get(date) ?? null,
      }))
    : [];

  // Spouse option for the attendee picker ("just me" / "me & spouse").
  // Uses the service client so pending profiles (spouse never logged in) are visible.
  let spouse: { id: string; name: string } | null = null;
  if (profile.family_id) {
    const service = await createServiceClient();
    // org_id comes from the caller's own RLS-scoped profile read above; the
    // filter is required on a service-role read even though the composite FK
    // already prevents a cross-org household.
    const { data: spouseRow } = await service
      .from("profiles")
      .select("id, first_name, last_name, preferred_name")
      .eq("family_id", profile.family_id)
      .eq("org_id", profile.org_id)
      .in("relationship", ["primary", "spouse"])
      .neq("id", user.id)
      .limit(1)
      .maybeSingle();
    if (spouseRow) {
      spouse = {
        id: spouseRow.id,
        name: spouseRow.preferred_name || spouseRow.first_name || "spouse",
      };
    }
  }

  const teamSettings = canManageRoster && (
    <ServingSettingsDialog
      teamId={teamId}
      settings={
        settings
          ? {
              enabled: settings.enabled ?? false,
              reminder_days: settings.reminder_days ?? [4, 5],
              window_weeks: settings.window_weeks ?? 8,
            }
          : null
      }
    />
  );

  return (
    <PageContainer size="reading">
      <PageHeader
        backHref={servingHref}
        backLabel="Back to Serving"
        title={
          <span className="flex items-center gap-3">
            <TeamDot color={team.color} />
            {team.name}
          </span>
        }
        subtitle={team.description || "Pick an open date to serve."}
      />

      {!settings?.enabled && canManageRoster && (
        <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-foreground">
            Signups are off for this team. Turn them on in Team settings.
          </p>
          {teamSettings}
        </div>
      )}

      {!canSignUp && (
        <p className="text-base text-muted-foreground mb-6">
          Only people on this team can sign up. Ask a leader or the team lead to add you.
        </p>
      )}

      {scheduleUnavailable ? (
        <ErrorState thing="the schedule" />
      ) : (
        <>
          {settings?.enabled && canManageRoster && (
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
              <EmailTeamButton
                teamId={teamId}
                teamName={team.name}
                openDates={dates.filter((d) => !entries[d])}
                today={today}
                memberCount={memberCount ?? 0}
              />
              {teamSettings}
            </div>
          )}

          <ServingSchedule
            teamId={teamId}
            teamName={team.name}
            dates={dates}
            today={today}
            entries={entries}
            userId={user.id}
            spouse={spouse}
            canSignUp={canSignUp}
            canManage={canManageRoster}
          />
        </>
      )}

      {canManageRoster && rosterUnavailable && (
        <ErrorState thing="the team roster" className="mt-10" />
      )}

      {canManageRoster && !rosterUnavailable && (
        <div className="mt-10">
          <TeamRoster
            teamId={teamId}
            teamName={team.name}
            groupName={group.name}
            members={rosterMembers}
            candidates={rosterCandidates}
          />
        </div>
      )}

      {historyEntries.length > 0 && (
        <ServingHistory entries={historyEntries} today={today} />
      )}
    </PageContainer>
  );
}
