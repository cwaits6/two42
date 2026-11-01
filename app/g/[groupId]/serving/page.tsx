import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, HandHelping } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoleRoster, type RosterMember } from "@/components/serving/RoleRoster";
import { TeamDot } from "@/components/serving/TeamDot";
import { formatServingDate, todayIn, upcomingServiceDates } from "@/lib/serving/dates";
import { personName } from "@/lib/serving/display";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import type { MemberGroup, ServingTeamSettings } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Serving");

// PostgREST embeds the joined profile as a to-one object.
type RosterRow = {
  team_id: string;
  is_leader: boolean;
  profiles: Omit<RosterMember, "is_leader"> & { role: string | null } | null;
};

const SECTION_HEADING = "text-base font-bold uppercase tracking-widest text-muted-foreground mb-4";

function TeamLeadBadge() {
  return (
    <span className="text-sm font-semibold uppercase tracking-wider text-brand-accent-text border border-brand-accent/40 rounded px-1.5 py-0.5">
      Team lead
    </span>
  );
}

/** "3 of 8 dates covered · next open Sun, Nov 8", from the dates in the team's window. */
function coverageLine(window: string[], covered: Set<string>, today: string): string {
  const coveredCount = window.filter((d) => covered.has(d)).length;
  const nextOpen = window.find((d) => !covered.has(d));
  const summary = `${coveredCount} of ${window.length} dates covered`;
  return nextOpen ? `${summary} · next open ${formatServingDate(nextOpen, today)}` : summary;
}

export default async function ServingPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();
  const user = await getOptionalUser();

  if (!user) redirect("/login");

  const isLeader = group.role === "leader";
  const teamsHref = groupPath(group.id, "/settings/teams");
  const today = todayIn(await getOrgTimeZone());

  const teams = readList<MemberGroup>(
    await supabase
      .from("teams")
      .select("*")
      .eq("group_id", group.id)
      .order("display_order"),
    "teams"
  );
  const teamIds = (teams ?? []).map((t) => t.id);

  const [settingsRead, rosterRead, membershipRead, signupRead] = await Promise.all([
    supabase.from("serving_team_settings").select("*").in("team_id", teamIds),
    supabase
      .from("team_members")
      .select(
        "team_id, is_leader, profiles(id, email, role, first_name, last_name, preferred_name, avatar_url)"
      )
      .in("team_id", teamIds),
    supabase
      .from("team_members")
      .select("team_id, is_leader")
      .eq("profile_id", user.id)
      .in("team_id", teamIds),
    supabase
      .from("serving_signups")
      .select("team_id, service_date")
      .in("team_id", teamIds)
      .gte("service_date", today),
  ]);
  const settingsRows = readList(settingsRead, "serving team settings") as ServingTeamSettings[] | null;
  const rosterList = readList(rosterRead, "team rosters") as unknown as RosterRow[] | null;
  const memberships = readList(membershipRead, "own team memberships");
  const signups = readList(signupRead, "upcoming serving signups");

  const header = (
    <PageHeader
      title="Serving"
      subtitle="Sign up to serve, and see who is on each team."
    />
  );

  if (!teams || !settingsRows || !rosterList || !memberships || !signups) {
    return (
      <PageContainer>
        {header}
        <ErrorState thing="serving teams" />
      </PageContainer>
    );
  }

  const settingsMap = new Map(settingsRows.map((s) => [s.team_id, s]));
  const membershipMap = new Map(memberships.map((m) => [m.team_id, m.is_leader as boolean]));

  // Private buckets: exchange stored avatar URLs for signed URLs
  // before the roster reaches RoleRoster's AvatarImage renders.
  const signedAvatars = await mintSignedUrls(
    rosterList.map((r) => r.profiles?.avatar_url),
  );
  rosterList.forEach((r, i) => {
    if (r.profiles) r.profiles.avatar_url = signedAvatars[i];
  });

  // Roster per team (RLS already hides unlisted / non-member profiles).
  // Team leads float to the top, then alphabetical by name.
  const rosters = new Map<string, RosterMember[]>();
  for (const row of rosterList) {
    // Skip un-onboarded household peers (no name yet, not real roster members).
    if (!row.profiles || row.profiles.role === "pending") continue;
    const list = rosters.get(row.team_id) ?? [];
    list.push({ ...row.profiles, is_leader: row.is_leader });
    rosters.set(row.team_id, list);
  }
  for (const list of rosters.values()) {
    list.sort((a, b) =>
      a.is_leader !== b.is_leader
        ? a.is_leader
          ? -1
          : 1
        : personName(a).localeCompare(personName(b))
    );
  }

  const isEnabled = (id: string) => settingsMap.get(id)?.enabled === true;
  // Signup teams and roster-only teams. A team lead also sees their own
  // signups-off team: this card is their only link to its roster.
  const signupTeams = teams.filter((t) => isEnabled(t.id));
  const rosterTeams = teams.filter(
    (t) =>
      !isEnabled(t.id) &&
      (t.is_serving_role || membershipMap.get(t.id) === true)
  );

  const coveredByTeam = new Map<string, Set<string>>();
  for (const s of signups) {
    const covered = coveredByTeam.get(s.team_id) ?? new Set<string>();
    covered.add(s.service_date);
    coveredByTeam.set(s.team_id, covered);
  }

  if (signupTeams.length === 0 && rosterTeams.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={HandHelping}
          message="No teams are serving yet."
          action={
            isLeader ? (
              <div className="flex flex-col items-center gap-4">
                <p className="text-base text-muted-foreground">
                  On Teams, edit a team and turn on Serving role, then turn on signups in its Team settings.
                </p>
                <Button nativeButton={false} render={<Link href={teamsHref} />}>
                  Go to Teams
                </Button>
              </div>
            ) : undefined
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}

      {signupTeams.length > 0 && (
        <section className="mb-12">
          <h2 className={SECTION_HEADING}>Sign up to serve</h2>
          <ul className="space-y-4">
            {signupTeams.map((team) => {
              const settings = settingsMap.get(team.id)!;
              const window = upcomingServiceDates(settings.window_weeks, today);
              const isTeamLead = membershipMap.get(team.id) === true;
              const isMember = membershipMap.has(team.id);
              const members = rosters.get(team.id) ?? [];
              return (
                <li key={team.id}>
                  <Link href={groupPath(group.id, `/serving/${team.id}`)} className="block">
                    <Card className="hover:border-brand-primary/50 transition-colors">
                      <CardContent className="py-5">
                        <div className="flex items-center gap-4">
                          <TeamDot color={team.color} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xl font-semibold flex flex-wrap items-center gap-2">
                              {team.name}
                              {isTeamLead && <TeamLeadBadge />}
                            </p>
                            <p className="text-base text-muted-foreground">
                              {coverageLine(window, coveredByTeam.get(team.id) ?? new Set(), today)}
                            </p>
                            {isMember && !isTeamLead && (
                              <p className="text-base text-muted-foreground">You&apos;re on this team</p>
                            )}
                            {!isMember && !isLeader && (
                              <p className="text-base text-muted-foreground">Team members sign up</p>
                            )}
                          </div>
                          <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" aria-hidden="true" />
                        </div>
                        {members.length > 0 && (
                          <div className="mt-4 pl-8">
                            <RoleRoster members={members} />
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rosterTeams.length > 0 && (
        <section className="mb-12">
          <h2 className={SECTION_HEADING}>Teams</h2>
          <ul className="space-y-4">
            {rosterTeams.map((team) => {
              const members = rosters.get(team.id) ?? [];
              const isMember = membershipMap.has(team.id);
              const canManage = isLeader || membershipMap.get(team.id) === true;
              const card = (
                <Card className={canManage ? "hover:border-brand-primary/50 transition-colors" : undefined}>
                  <CardContent className="py-5">
                    <div className="flex items-center gap-4">
                      <TeamDot color={team.color} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xl font-semibold flex flex-wrap items-center gap-2">
                          {team.name}
                          {membershipMap.get(team.id) === true && <TeamLeadBadge />}
                        </p>
                        {team.description && (
                          <p className="text-base text-muted-foreground">{team.description}</p>
                        )}
                        {isMember && membershipMap.get(team.id) !== true && (
                          <p className="text-base text-muted-foreground">You&apos;re on this team</p>
                        )}
                      </div>
                      {canManage && (
                        <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" aria-hidden="true" />
                      )}
                    </div>
                    <div className="mt-4 pl-8">
                      <RoleRoster members={members} />
                    </div>
                  </CardContent>
                </Card>
              );
              return (
                <li key={team.id}>
                  {canManage ? (
                    <Link href={groupPath(group.id, `/serving/${team.id}`)} className="block">
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
