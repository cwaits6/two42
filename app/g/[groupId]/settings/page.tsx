import { redirect } from "next/navigation";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { firstGroupSettingsSection } from "@/lib/groups/settingsNav";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Group settings");

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  redirect(firstGroupSettingsSection(group) ?? groupPath(group.id, "/dashboard"));
}
