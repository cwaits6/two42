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

  // The form still works without the group's sharing settings: it says it is
  // following them without naming them, and saves nulls that follow them.
  const [calendar, timeZone, sharing] = await Promise.all([
    getGroupCalendar(supabase, profile.org_id, group.id),
    getOrgTimeZone(),
    getGroupSettings(supabase, profile.org_id, group.id).then(groupSharing, () => null),
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
        groupSharing={sharing}
      />
    </Suspense>
  );
}
