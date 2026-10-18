import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { EditSeriesForm } from "./EditSeriesForm";

export const metadata = { title: `Edit lecture series | ${siteConfig.name}` };

export default async function EditSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  return <EditSeriesForm groupId={group.id} groupName={group.name} seriesId={id} />;
}
