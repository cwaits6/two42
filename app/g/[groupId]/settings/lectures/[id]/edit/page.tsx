import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { EditLectureForm } from "./EditLectureForm";

export const metadata = { title: `Edit lecture | ${siteConfig.name}` };

export default async function EditLecturePage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  return <EditLectureForm groupId={group.id} groupName={group.name} lectureId={id} />;
}
