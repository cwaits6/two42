import { GroupDashboard } from "@/components/groups/GroupDashboard";
import { requireActiveGroup } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Dashboard");

export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  return <GroupDashboard group={group} />;
}
