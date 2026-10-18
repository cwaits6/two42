import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { NewAnnouncementForm } from "./NewAnnouncementForm";

export const metadata = { title: `New announcement | ${siteConfig.name}` };

export default async function NewAnnouncementPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewAnnouncementForm groupId={group.id} groupName={group.name} />;
}
