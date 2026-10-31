import { requireGroupLeader } from "@/lib/groups/server";
import { EditAnnouncementForm } from "./EditAnnouncementForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Edit announcement");

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  return (
    <EditAnnouncementForm groupId={group.id} groupName={group.name} announcementId={id} />
  );
}
