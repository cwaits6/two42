import { redirect } from "next/navigation";
import { ErrorState } from "@/components/states/ErrorState";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { groupPageTitle } from "@/lib/pageTitle";
import { defaultServingLinkMode } from "@/lib/serving/config";
import { todayIn } from "@/lib/serving/dates";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { ServingLinkModeForm } from "./ServingLinkModeForm";
import { ServingStats } from "./ServingStats";
import { TeamsManager } from "./TeamsManager";

export const generateMetadata = groupPageTitle("Teams");

export default async function GroupTeamsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupSettingsLeader(groupId);
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
    // getGroupSettings logs its own failure; the section reports it.
    getGroupSettings(supabase, profile.org_id, group.id).catch(() => null),
    getOrgTimeZone(),
  ]);

  return (
    <TeamsManager groupId={group.id} groupName={group.name}>
      <section className="mt-10 space-y-6" aria-labelledby="serving-emails-heading">
        <h2 id="serving-emails-heading" className="text-2xl font-bold text-brand-primary-text">
          Serving emails
        </h2>
        {settings ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <ServingLinkModeForm
              groupId={group.id}
              initialMode={settings.serving_link_mode ?? defaultServingLinkMode()}
            />
          </div>
        ) : (
          <ErrorState thing="the serving email setting" />
        )}
      </section>
      <div className="mt-10">
        <ServingStats groupId={group.id} today={todayIn(zone)} />
      </div>
    </TeamsManager>
  );
}
