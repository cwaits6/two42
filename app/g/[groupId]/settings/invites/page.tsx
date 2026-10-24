import { siteConfig } from "@/lib/config";
import { requireGroupLeader } from "@/lib/groups/server";
import { InviteLinksManager } from "./InviteLinksManager";

export const metadata = { title: `Invite links | Group settings | ${siteConfig.name}` };

export default async function GroupInviteLinksSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <InviteLinksManager groupId={group.id} groupName={group.name} />;
}
