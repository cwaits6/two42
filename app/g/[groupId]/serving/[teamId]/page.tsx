import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { ownSignupLabel, personName, signupDisplayName, spouseFirstName } from "@/lib/serving/display";
import {
  DEFAULT_TEAM_DATES,
  openDatesLine,
  pastServiceDates,
  teamServiceDates,
  todayIn,
} from "@/lib/serving/dates";
import { findSpouse } from "@/lib/serving/server";
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
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

type RosterProfile = TeamRosterPerson & { role: string };

const byName = (a: TeamRosterPerson, b: TeamRosterPerson) =>
  personName(a).localeCompare(personName(b));

const SIGNUP_SELECT =
  "id, service_date, created_by, serving_signup_attendees(profiles(id, first_name, last_name, preferred_name))";

const ROSTER_PROFILE =
  "profiles(id, role, first_name, last_name, preferred_name, avatar_url, family_id, relationship)";

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
        .select("id, org_id, role, family_id, relationship, first_name, last_name, preferred_name")
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
        .select(`is_leader, ${ROSTER_PROFILE}`)
        .eq("team_id", teamId),
      canManageRoster
        ? supabase
            .from("group_members")
            .select(ROSTER_PROFILE)
            .eq("group_id", group.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
  // A failed read would otherwise render as an empty roster or an empty
  // group, and the add mode's empty-state copy would state that as fact.
  const rosterUnavailable = !!(memberError || groupError);
  if (memberError) console.error("team roster read failed:", memberError.message);
  if (groupError) console.error("team roster group read failed:", groupError.message);

  // How many people an email to the team reaches. Only the server knows who
  // has an address; null when it could not say, and the dialog then names no
  // number rather than a guess from the roster.
  let emailReach: number | null = null;
  if (canManageRoster) {
    const { data: reach, error: reachError } = await supabase.rpc("serving_team_email_count", {
      _team_id: teamId,
    });
    if (reachError) console.error("team email count read failed, code:", reachError.code);
    else emailReach = reach;
  }

  // Pending profiles are household peers who never signed in, not people to
  // put on a team. A null embed is a profile RLS hides from the viewer.
  let rosterMembers: TeamRosterMember[] = [];
  let rosterCandidates: TeamRosterPerson[] = [];
  if (canManageRoster && !rosterUnavailable) {
    const person = (p: RosterProfile): TeamRosterPerson => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      preferred_name: p.preferred_name,
      avatar_url: p.avatar_url,
      family_id: p.family_id,
      relationship: p.relationship,
    });
    const onTeam = new Set<string>();
    for (const row of memberRows ?? []) {
      const p = row.profiles as unknown as RosterProfile | null;
      if (!p) continue;
      onTeam.add(p.id);
      if (p.role === "pending") continue;
      rosterMembers.push({ ...person(p), is_leader: row.is_leader });
    }
    for (const row of groupRows ?? []) {
      const p = row.profiles as unknown as RosterProfile | null;
      if (!p || p.role === "pending" || onTeam.has(p.id)) continue;
      rosterCandidates.push(person(p));
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
  const teamDates = settings
    ? {
        schedule: settings.schedule === "set" ? ("set" as const) : ("rolling" as const),
        window_weeks: settings.window_weeks,
        date_from: settings.date_from,
        date_to: settings.date_to,
      }
    : DEFAULT_TEAM_DATES;
  const dates = teamServiceDates(teamDates, today);

  // One bounded read for the dates shown, however long the block, and one
  // for everything before it.
  const [signupRead, pastSignupRead] = await Promise.all([
    dates.length > 0
      ? supabase
          .from("serving_signups")
          .select(SIGNUP_SELECT)
          .eq("team_id", teamId)
          .gte("service_date", dates[0])
          .lte("service_date", dates[dates.length - 1])
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("serving_signups")
      .select(SIGNUP_SELECT)
      .eq("team_id", teamId)
      .lt("service_date", dates[0] ?? today)
      .order("service_date", { ascending: false }),
  ]);
  const signups = readList(signupRead, "upcoming serving signups");
  const pastSignupRows = readList(pastSignupRead, "past serving signups");
  const scheduleUnavailable = !signups || !pastSignupRows;

  const toEntry = (s: NonNullable<typeof signups>[number]): ScheduleEntry => {
    const attendees = (s.serving_signup_attendees ?? [])
      .map((a) => a.profiles as unknown as AttendeeProfile)
      .filter(Boolean)
      // Whoever tapped Sign up comes first in a couple's name.
      .sort((a, b) => (a.id === s.created_by ? -1 : b.id === s.created_by ? 1 : 0));
    return {
      id: s.id,
      date: s.service_date,
      createdBy: s.created_by ?? "",
      attendeeIds: attendees.map((a) => a.id),
      label: signupDisplayName(attendees),
      ownLabel: ownSignupLabel(attendees, user.id),
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

  // The spouse option for "Me & Ben", on the service client so a spouse who
  // never signed in (a pending profile) is still found. org_id comes from
  // the caller's own RLS-scoped profile read above.
  const spouseRow = await findSpouse(await createServiceClient(), profile, profile.org_id, teamId);
  const spouse = spouseRow ? { id: spouseRow.id, name: spouseFirstName(spouseRow) } : null;

  const teamSettings = canManageRoster && (
    <ServingSettingsDialog
      teamId={teamId}
      settings={
        settings
          ? {
              enabled: settings.enabled ?? false,
              reminder_days: settings.reminder_days ?? [4, 5],
              ...teamDates,
              extra_weeks: settings.extra_weeks ?? 0,
              send_hour: settings.send_hour ?? null,
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
        subtitle={
          settings?.enabled && !scheduleUnavailable
            ? openDatesLine(dates, (d) => !entries[d], today)
            : team.description || undefined
        }
      />

      {!settings?.enabled && canManageRoster && (
        <div className="mb-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-base text-foreground">
            Signing up is off for this team. Turn it on in Team settings.
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
                emailReach={emailReach}
              />
              {teamSettings}
            </div>
          )}

          <ServingSchedule
            teamId={teamId}
            dates={dates}
            today={today}
            entries={entries}
            userId={user.id}
            spouse={spouse}
            extraWeeks={settings?.extra_weeks ?? 0}
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
