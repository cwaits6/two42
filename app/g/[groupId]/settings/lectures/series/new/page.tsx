import { requireGroupLeader } from "@/lib/groups/server";
import { NewSeriesForm } from "./NewSeriesForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("New lecture series");

export default async function NewSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewSeriesForm groupId={group.id} groupName={group.name} />;
}
