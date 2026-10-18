import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";
import { NewLectureForm } from "./NewLectureForm";

export const metadata = { title: `Add lecture | ${siteConfig.name}` };

export default async function NewLecturePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return <NewLectureForm groupId={group.id} groupName={group.name} />;
}
