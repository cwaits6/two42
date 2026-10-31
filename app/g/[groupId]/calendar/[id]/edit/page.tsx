import { Suspense } from "react";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
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
  const timeZone = await getOrgTimeZone();

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 max-w-2xl">Loading...</div>}>
      <EditEventForm groupId={group.id} eventId={id} timeZone={timeZone} />
    </Suspense>
  );
}
