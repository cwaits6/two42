import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { getGroupSettings } from "@/lib/groups/settings";
import { groupPath } from "@/lib/groups/active";
import { defaultServingLinkMode } from "@/lib/serving/config";
import { todayIn } from "@/lib/serving/dates";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { ServingLinkModeForm } from "./ServingLinkModeForm";
import { ServingStats } from "./ServingStats";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Serving settings");

export default async function GroupServingSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/dashboard");

  const [settings, zone] = await Promise.all([
    getGroupSettings(supabase, profile.org_id, group.id),
    getOrgTimeZone(),
  ]);
  const teamsHref = groupPath(group.id, "/settings/teams");

  return (
    <PageContainer>
      <PageHeader
        title="Serving"
        subtitle={`Serving emails and history for ${group.name}.`}
        backHref={groupPath(group.id, "/settings")}
        backLabel="Back to Group settings"
      />

      <section className="rounded-2xl border border-border bg-card p-6 mb-6">
        <ServingLinkModeForm
          groupId={group.id}
          initialMode={settings.serving_link_mode ?? defaultServingLinkMode()}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-medium text-foreground">Teams, rosters and signups</h2>
          <p className="text-base text-muted-foreground">
            Choose which teams serve, who is on them and when signups are on.
          </p>
        </div>
        <Button variant="outline" nativeButton={false} render={<Link href={teamsHref} />}>
          Go to Teams
        </Button>
      </section>

      <ServingStats groupId={group.id} today={todayIn(zone)} teamsHref={teamsHref} />
    </PageContainer>
  );
}
