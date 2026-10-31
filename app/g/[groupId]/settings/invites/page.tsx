import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { InviteLinksManager } from "./InviteLinksManager";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Invite links");

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
