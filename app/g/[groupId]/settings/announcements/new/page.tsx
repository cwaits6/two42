import { requireGroupLeader } from "@/lib/groups/server";
import { NewAnnouncementForm } from "./NewAnnouncementForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Add announcement");

export default async function NewAnnouncementPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewAnnouncementForm groupId={group.id} groupName={group.name} />;
}
