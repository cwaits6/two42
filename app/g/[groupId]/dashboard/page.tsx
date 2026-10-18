import { GroupDashboard } from "@/components/groups/GroupDashboard";
import { requireActiveGroup } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Dashboard | ${siteConfig.name}` };

export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  return <GroupDashboard group={group} />;
}
