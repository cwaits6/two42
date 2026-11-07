import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { createClient } from "@/lib/supabase/server";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { parseJoinPolicy } from "@/lib/groups/joining";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { PrivacyAndJoiningManager } from "./PrivacyAndJoiningManager";
import { groupPageTitle } from "@/lib/pageTitle";
import { logError } from "@/lib/log";

export const generateMetadata = groupPageTitle("Privacy and joining");

export default async function GroupPrivacySettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupSettingsLeader(groupId);
  const supabase = await createClient();
  const [{ data: flags, error }, orgDiscoveryOn] = await Promise.all([
    supabase.from("groups").select("is_private, join_policy").eq("id", group.id).maybeSingle(),
    getDiscoveryOn(),
  ]);

  // Never show the controls with guessed values: a leader who sees "not
  // private" for a private group may save the wrong state on top of it.
  if (error || !flags) {
    logError("Failed to load the group's privacy settings", error ?? "no row", { route: "/g/[groupId]/settings/privacy" });
    return (
      <PageContainer>
        <PageHeader
          title="Privacy and joining"
          subtitle={group.name}
        />
        <ErrorState thing="this group's privacy settings" />
      </PageContainer>
    );
  }

  return (
    <PrivacyAndJoiningManager
      groupId={group.id}
      groupName={group.name}
      initialPrivate={flags.is_private}
      initialPolicy={parseJoinPolicy(flags.join_policy)}
      orgDiscoveryOn={orgDiscoveryOn}
    />
  );
}
