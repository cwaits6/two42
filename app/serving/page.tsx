import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { toDateString, upcomingSundays } from "@/lib/serving/sundays";
import { AdminServingSetup } from "@/components/serving/AdminServingSetup";
import { RoleRoster, type RosterMember } from "@/components/serving/RoleRoster";
import { displayName } from "@/lib/names";
import type { MemberGroup, ServingTeamSettings } from "@/lib/types";

export const metadata = { title: `Serving | ${siteConfig.name}` };

// PostgREST embeds the joined profile as a to-one object.
type RosterRow = {
  group_id: string;
  is_leader: boolean;
  profiles: {
    id: string;
    role: string | null;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    avatar_url: string | null;
  } | null;
};

export default async function ServingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role === "pending") redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  const [
    { data: groupRows },
    { data: settingsRows },
    { data: rosterRows },
    { data: memberships },
  ] = await Promise.all([
    supabase.from("member_groups").select("*").order("display_order"),
    supabase.from("serving_team_settings").select("*"),
    supabase
      .from("profile_groups")
      .select(
        "group_id, is_leader, profiles(id, role, first_name, last_name, preferred_name, avatar_url)"
      ),
    supabase
      .from("profile_groups")
      .select("group_id, is_leader")
      .eq("profile_id", user.id),
  ]);

  const groups = (groupRows ?? []) as MemberGroup[];
  const settingsMap = new Map(
    ((settingsRows ?? []) as ServingTeamSettings[]).map((s) => [s.group_id, s])
  );
  const membershipMap = new Map(
    (memberships ?? []).map((m) => [m.group_id, m.is_leader as boolean])
  );

  // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
  // before the roster reaches RoleRoster's AvatarImage renders.
  const rosterList = (rosterRows ?? []) as unknown as RosterRow[];
  const signedAvatars = await mintSignedUrls(
    rosterList.map((r) => r.profiles?.avatar_url),
  );
  rosterList.forEach((r, i) => {
    if (r.profiles) r.profiles.avatar_url = signedAvatars[i];
  });

  // Roster per group (RLS already hides unlisted / non-member profiles).
  // Leaders float to the top, then alphabetical by display name.
  const rosters = new Map<string, RosterMember[]>();
  for (const row of rosterList) {
    // Skip un-onboarded household peers (no name yet, not real roster members).
    if (!row.profiles || row.profiles.role === "pending") continue;
    const list = rosters.get(row.group_id) ?? [];
    list.push({ ...row.profiles, is_leader: row.is_leader });
    rosters.set(row.group_id, list);
  }
  for (const list of rosters.values()) {
    list.sort((a, b) =>
      a.is_leader !== b.is_leader
        ? a.is_leader
          ? -1
          : 1
        : displayName(a).localeCompare(displayName(b))
    );
  }

  const isEnabled = (id: string) => settingsMap.get(id)?.enabled === true;
  // Signup teams (Sunday signups on) and roster-only standing roles.
  const signupTeams = groups.filter((g) => isEnabled(g.id));
  const roleGroups = groups.filter((g) => g.is_serving_role && !isEnabled(g.id));

  // Coverage counts for each signup team's upcoming window
  const today = toDateString(new Date());
  const coverage = new Map<string, number>();
  if (signupTeams.length > 0) {
    const { data: signups } = await supabase
      .from("serving_signups")
      .select("group_id, service_date")
      .in(
        "group_id",
        signupTeams.map((g) => g.id)
      )
      .gte("service_date", today);

    for (const g of signupTeams) {
      const window = new Set(upcomingSundays(settingsMap.get(g.id)!.window_weeks));
      coverage.set(
        g.id,
        (signups ?? []).filter(
          (s) => s.group_id === g.id && window.has(s.service_date)
        ).length
      );
    }
  }

  // Groups an admin could still turn signups on for
  const candidateGroups: Pick<MemberGroup, "id" | "name" | "color">[] = isAdmin
    ? groups.filter((g) => !isEnabled(g.id))
    : [];

  const nothingToShow = signupTeams.length === 0 && roleGroups.length === 0;

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
        Serving
      </h1>
      <p className="text-lg text-muted-foreground mb-10">
        Sign up to serve on a Sunday, and see the teams and roles that keep our
        class running.
      </p>

      {signupTeams.length > 0 && (
        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Sign up to serve
          </h2>
          <div className="space-y-4">
            {signupTeams.map((group) => {
              const settings = settingsMap.get(group.id)!;
              const covered = coverage.get(group.id) ?? 0;
              const isLeader = membershipMap.get(group.id) === true;
              const isMember = membershipMap.has(group.id);
              const members = rosters.get(group.id) ?? [];
              return (
                <Link key={group.id} href={`/serving/${group.id}`}>
                  <Card className="mb-4 hover:border-brand-primary/50 transition-colors">
                    <CardContent className="py-5">
                      <div className="flex items-center gap-4">
                        <span
                          className="inline-block w-4 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: group.color ?? "var(--color-brand-primary)" }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xl font-semibold flex items-center gap-2">
                            {group.name}
                            {isLeader && (
                              <span className="text-xs font-medium uppercase tracking-wider text-brand-accent border border-brand-accent/40 rounded px-1.5 py-0.5">
                                Leader
                              </span>
                            )}
                          </p>
                          <p className="text-muted-foreground">
                            {covered} of the next {settings.window_weeks} Sundays
                            covered
                            {isMember && !isLeader ? " · You're on this team" : ""}
                            {!isMember && !isAdmin ? " · Members sign up" : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-6 w-6 text-muted-foreground shrink-0" />
                      </div>
                      {members.length > 0 && (
                        <div className="mt-4 pl-8">
                          <RoleRoster members={members} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {roleGroups.length > 0 && (
        <section className="mb-12">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Teams &amp; roles
          </h2>
          <div className="space-y-4">
            {roleGroups.map((group) => {
              const members = rosters.get(group.id) ?? [];
              const isMember = membershipMap.has(group.id);
              return (
                <Card key={group.id}>
                  <CardContent className="py-5">
                    <div className="flex items-center gap-4">
                      <span
                        className="inline-block w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: group.color ?? "var(--color-brand-primary)" }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xl font-semibold flex items-center gap-2">
                          {group.name}
                          {isMember && (
                            <span className="text-xs font-medium uppercase tracking-wider text-brand-accent border border-brand-accent/40 rounded px-1.5 py-0.5">
                              You&apos;re in this group
                            </span>
                          )}
                        </p>
                        {group.description && (
                          <p className="text-muted-foreground">
                            {group.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 pl-8">
                      <RoleRoster members={members} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {nothingToShow && (
        <p className="text-xl text-muted-foreground">
          No serving teams or roles are set up yet.
        </p>
      )}

      {isAdmin && candidateGroups.length > 0 && (
        <AdminServingSetup groups={candidateGroups} />
      )}
    </div>
  );
}
