import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { getGroupCalendar, GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { getGroupSettings } from "@/lib/groups/settings";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { groupReminders } from "@/lib/events/reminders";
import { GroupDetailsForm } from "./GroupDetailsForm";
import { logError } from "@/lib/log";

export const generateMetadata = groupPageTitle("Details");

export default async function GroupDetailsSettingsPage({
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

  const [{ data: details, error }, calendar, settings] = await Promise.all([
    supabase.from("groups").select("name, description").eq("id", group.id).maybeSingle(),
    getGroupCalendar(supabase, profile.org_id, group.id),
    getGroupSettings(supabase, profile.org_id, group.id),
  ]);
  if (error) logError("Failed to load the group's details", error, { route: "/g/[groupId]/settings/details" });

  return (
    <PageContainer size="reading">
      <PageHeader title="Details" subtitle={`Changes here apply to ${group.name} only.`} />
      {details ? (
        <GroupDetailsForm
          groupId={group.id}
          cancelHref={groupPath(group.id, "/dashboard")}
          initialName={details.name}
          initialDescription={details.description}
          initialFields={{
            color: calendar?.color ?? GROUP_DEFAULT_COLOR,
            calendar: {
              calendar_meeting_details: settings.calendar_meeting_details,
              calendar_event_notes: settings.calendar_event_notes,
              calendar_event_location: settings.calendar_event_location,
            },
            reminders: groupReminders(settings),
          }}
        />
      ) : (
        <ErrorState thing="this group's details" />
      )}
    </PageContainer>
  );
}
