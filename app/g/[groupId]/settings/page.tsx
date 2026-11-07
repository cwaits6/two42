import { redirect } from "next/navigation";
import { groupPath } from "@/lib/groups/active";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Group settings");

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupSettingsLeader(groupId);
  redirect(groupPath(group.id, "/settings/details"));
}
