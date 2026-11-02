import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { getGroupCalendar, GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { requireGroupLeader } from "@/lib/groups/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { CalendarSubscriptionCard } from "./CalendarSubscriptionCard";
import { GroupDetailsForm } from "./GroupDetailsForm";

export const generateMetadata = groupPageTitle("Group details");

export default async function GroupDetailsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const settingsHref = groupPath(group.id, "/settings");

  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/dashboard");

  const [{ data: details, error }, calendar, settings] = await Promise.all([
    supabase.from("groups").select("name, description").eq("id", group.id).maybeSingle(),
    getGroupCalendar(supabase, profile.org_id, group.id),
    getGroupSettings(supabase, profile.org_id, group.id),
  ]);
  if (error) console.error("Failed to load the group's details: code=%s", error.code);

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Group details"
        subtitle={`Changes here apply to ${group.name} only.`}
        backHref={settingsHref}
        backLabel="Back to Group settings"
      />
      {details ? (
        <div className="space-y-8">
          <GroupDetailsForm
            groupId={group.id}
            cancelHref={settingsHref}
            initialName={details.name}
            initialDescription={details.description}
            initialColor={calendar?.color ?? GROUP_DEFAULT_COLOR}
            initialVideoCallUrl={settings.weekly_zoom_url ?? ""}
            initialVideoCallTime={settings.zoom_meeting_time ?? ""}
          />
          <CalendarSubscriptionCard
            groupId={group.id}
            initial={{
              calendar_meeting_details: settings.calendar_meeting_details,
              calendar_event_notes: settings.calendar_event_notes,
              calendar_event_location: settings.calendar_event_location,
            }}
          />
        </div>
      ) : (
        <ErrorState thing="this group's details" />
      )}
    </PageContainer>
  );
}
