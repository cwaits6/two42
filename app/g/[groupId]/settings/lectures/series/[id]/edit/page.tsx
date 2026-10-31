import { requireGroupLeader } from "@/lib/groups/server";
import { EditSeriesForm } from "./EditSeriesForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Edit series");

export default async function EditSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  return <EditSeriesForm groupId={group.id} groupName={group.name} seriesId={id} />;
}
