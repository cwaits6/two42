import { requireActiveGroup } from "@/lib/groups/server";

// Membership is verified here before any child renders; a non-member gets
// a 404 for the whole subtree. The root layout's GroupProvider already
// covers this tree, so nothing is re-provided.
export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  await requireActiveGroup(groupId);
  return <>{children}</>;
}
