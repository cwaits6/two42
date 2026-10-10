import { DirectoryTiles } from "@/components/directory/DirectoryTiles";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = {
  title: "Directory",
};

export default async function GroupDirectoryPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  return <DirectoryTiles directoryHref={groupPath(group.id, "/directory")} />;
}
