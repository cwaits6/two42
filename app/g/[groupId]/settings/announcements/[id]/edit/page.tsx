import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { EditAnnouncementForm } from "./EditAnnouncementForm";

export const metadata = { title: `Edit announcement | ${siteConfig.name}` };

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
