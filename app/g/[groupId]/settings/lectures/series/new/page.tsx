import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { NewSeriesForm } from "./NewSeriesForm";

export const metadata = { title: `New lecture series | ${siteConfig.name}` };

export default async function NewSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewSeriesForm groupId={group.id} groupName={group.name} />;
}
