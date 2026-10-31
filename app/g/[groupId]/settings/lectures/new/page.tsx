import { requireGroupLeader } from "@/lib/groups/server";
import { NewLectureForm } from "./NewLectureForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Add lesson");

export default async function NewLecturePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewLectureForm groupId={group.id} groupName={group.name} />;
}
