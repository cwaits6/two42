import { requireGroupLeader } from "@/lib/groups/server";
import { LabelsManager } from "./LabelsManager";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Labels");

export default async function GroupLabelsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <LabelsManager groupId={group.id} groupName={group.name} />;
}
