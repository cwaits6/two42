import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { NewEventForm } from "@/components/events/NewEventForm";
import { createClient } from "@/lib/supabase/server";
import { getGroupCalendar } from "@/lib/groups/calendar";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { groupPageTitle } from "@/lib/pageTitle";
import { getGroupSettings } from "@/lib/groups/settings";
import { groupSharing } from "@/lib/calendar/sharing";
import { GROUP_REMINDERS_DEFAULT, groupReminders } from "@/lib/events/reminders";

export const generateMetadata = groupPageTitle("Add event");

export default async function NewEventPage({
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

  // The form still works without the group's settings: it says it is
  // following the sharing ones without naming them and saves nulls that
  // follow them, and the reminder starts on 1 day before.
  const [calendar, timeZone, settings] = await Promise.all([
    getGroupCalendar(supabase, profile.org_id, group.id),
    getOrgTimeZone(),
    getGroupSettings(supabase, profile.org_id, group.id).catch(() => null),
  ]);

  return (
    <Suspense
      fallback={
        <PageContainer size="reading">
          <PageHeader title="Add event" />
          <LoadingState thing="the form" />
        </PageContainer>
      }
    >
      <NewEventForm
        groupId={group.id}
        groupName={group.name}
        orgId={profile.org_id}
        calendarId={calendar?.id ?? null}
        timeZone={timeZone}
        groupSharing={settings && groupSharing(settings)}
        groupReminders={settings ? groupReminders(settings) : GROUP_REMINDERS_DEFAULT}
      />
    </Suspense>
  );
}
