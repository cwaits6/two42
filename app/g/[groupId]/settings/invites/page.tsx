import { siteConfig } from "@/lib/config";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { InviteLinksManager } from "./InviteLinksManager";

export const metadata = { title: `Invite links | Group settings | ${siteConfig.name}` };

export default async function GroupInviteLinksSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const timeZone = await getOrgTimeZone();
  return <InviteLinksManager groupId={group.id} groupName={group.name} timeZone={timeZone} />;
}
