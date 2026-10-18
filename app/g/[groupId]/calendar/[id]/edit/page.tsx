import { Suspense } from "react";
import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { EditEventForm } from "./EditEventForm";

export const metadata = { title: `Edit Event | ${siteConfig.name}` };

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);

  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-12 max-w-2xl">Loading...</div>}>
      <EditEventForm groupId={group.id} eventId={id} />
    </Suspense>
  );
}
