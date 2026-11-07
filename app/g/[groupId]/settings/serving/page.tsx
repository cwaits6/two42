import { redirect } from "next/navigation";
import { groupPath } from "@/lib/groups/active";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Teams");

/** The serving settings live on Teams; this address is kept for old links. */
export default async function GroupServingSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupSettingsLeader(groupId);
  redirect(groupPath(group.id, "/settings/teams"));
}
