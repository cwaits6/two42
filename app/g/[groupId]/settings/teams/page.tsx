import { siteConfig } from "@/lib/config";
import { requireGroupLeader } from "@/lib/groups/server";
import { TeamsManager } from "./TeamsManager";

export const metadata = { title: `Teams | Group settings | ${siteConfig.name}` };

export default async function GroupTeamsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <TeamsManager groupId={group.id} groupName={group.name} />;
}
