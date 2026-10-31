import { requireGroupLeader } from "@/lib/groups/server";
import { EditLectureForm } from "./EditLectureForm";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Edit lecture");

export default async function EditLecturePage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  return <EditLectureForm groupId={group.id} groupName={group.name} lectureId={id} />;
}
