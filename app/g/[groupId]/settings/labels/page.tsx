import { siteConfig } from "@/lib/config";
import { requireGroupLeader } from "@/lib/groups/server";
import { LabelsManager } from "./LabelsManager";

export const metadata = { title: `Labels | Group settings | ${siteConfig.name}` };

export default async function GroupLabelsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <LabelsManager groupId={group.id} groupName={group.name} />;
}
