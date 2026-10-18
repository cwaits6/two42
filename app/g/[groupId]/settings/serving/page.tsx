import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { getGroupSettings } from "@/lib/groups/settings";
import { requireGroupLeader } from "@/lib/groups/server";
import { AdminServingSetup } from "@/components/serving/AdminServingSetup";
import { ServingLinkModeForm } from "@/components/groups/ServingLinkModeForm";
import { ServingStats } from "./ServingStats";
import type { MemberGroup } from "@/lib/types";

export const metadata = { title: `Serving | Group settings | ${siteConfig.name}` };

export default async function GroupServingSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/dashboard");

  const [settings, { data: teamRows }] = await Promise.all([
    getGroupSettings(supabase, profile.org_id, group.id),
    supabase
      .from("teams")
      .select("id, name, color")
      .eq("group_id", group.id)
      .order("display_order"),
  ]);

  const teams = (teamRows ?? []) as Pick<MemberGroup, "id" | "name" | "color">[];
  const teamIds = teams.map((t) => t.id);
  const { data: settingsRows } = teamIds.length
    ? await supabase
        .from("serving_team_settings")
        .select("team_id")
        .in("team_id", teamIds)
    : { data: [] };
  const configured = new Set((settingsRows ?? []).map((s) => s.team_id as string));
  const candidateTeams = teams.filter((t) => !configured.has(t.id));

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
          Serving
        </h1>
        <p className="text-lg text-muted-foreground">
          Serving settings for {group.name}.
        </p>
      </div>

      <section className="rounded-2xl border border-border bg-card p-6 mb-10">
        <ServingLinkModeForm groupId={group.id} initialMode={settings.serving_link_mode} />
      </section>

      {candidateTeams.length > 0 && (
        <div className="mb-10">
          <AdminServingSetup groups={candidateTeams} />
        </div>
      )}

      <ServingStats groupId={group.id} />
    </div>
  );
}
