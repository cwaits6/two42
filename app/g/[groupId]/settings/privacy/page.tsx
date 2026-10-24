import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { parseJoinPolicy } from "@/lib/groups/joining";
import { requireGroupLeader } from "@/lib/groups/server";
import { PrivacyAndJoiningManager } from "./PrivacyAndJoiningManager";

export const metadata = { title: `Privacy and joining | Group settings | ${siteConfig.name}` };

export default async function GroupPrivacySettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const [{ data: flags }, orgDiscoveryOn] = await Promise.all([
    supabase.from("groups").select("is_private, join_policy").eq("id", group.id).maybeSingle(),
    getDiscoveryOn(),
  ]);

  return (
    <PrivacyAndJoiningManager
      groupId={group.id}
      groupName={group.name}
      initialPrivate={flags?.is_private ?? false}
      initialPolicy={parseJoinPolicy(flags?.join_policy)}
      orgDiscoveryOn={orgDiscoveryOn}
    />
  );
}
