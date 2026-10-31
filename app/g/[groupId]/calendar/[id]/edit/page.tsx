import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { groupPath } from "@/lib/groups/active";
import type { Event } from "@/lib/types";
import { EditEventForm } from "./EditEventForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Edit event");

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const [{ data: event, error }, timeZone] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).eq("group_id", group.id).maybeSingle(),
    getOrgTimeZone(),
  ]);

  if (error) {
    console.error("Failed to load the event to edit:", error);
    return (
      <PageContainer size="reading">
        <PageHeader
          title="Edit event"
          backHref={groupPath(group.id, "/calendar")}
          backLabel="Back to Calendar"
        />
        <ErrorState thing="the event" />
      </PageContainer>
    );
  }
  if (!event) notFound();

  // The form reads the occurrence date from the URL.
  return (
    <Suspense
      fallback={
        <PageContainer size="reading">
          <PageHeader title="Edit event" />
          <LoadingState thing="the event" />
        </PageContainer>
      }
    >
      <EditEventForm groupId={group.id} event={event as Event} timeZone={timeZone} />
    </Suspense>
  );
}
