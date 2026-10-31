import { requireGroupLeader } from "@/lib/groups/server";
import { TeamsManager } from "./TeamsManager";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Teams");

export default async function GroupTeamsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <TeamsManager groupId={group.id} groupName={group.name} />;
}
