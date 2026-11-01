import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { groupPageTitle } from "@/lib/pageTitle";
import { AnnouncementForm } from "../AnnouncementForm";

export const generateMetadata = groupPageTitle("Add announcement");

export default async function NewAnnouncementPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const timeZone = await getOrgTimeZone();
  return <AnnouncementForm groupId={group.id} groupName={group.name} timeZone={timeZone} />;
}
