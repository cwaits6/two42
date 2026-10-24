import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { groupPath } from "@/lib/groups/active";
import { parseJoinPolicy } from "@/lib/groups/joining";
import { requireGroupLeader } from "@/lib/groups/server";
import { PrivacyAndJoiningManager } from "./PrivacyAndJoiningManager";

export const metadata = { title: `Privacy and joining | Group settings | ${siteConfig.name}` };

const SETTINGS_UNAVAILABLE_TEXT =
  "Couldn't load this group's privacy settings. Reload the page to try again.";

export default async function GroupPrivacySettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const [{ data: flags, error }, orgDiscoveryOn] = await Promise.all([
    supabase.from("groups").select("is_private, join_policy").eq("id", group.id).maybeSingle(),
    getDiscoveryOn(),
  ]);

  // Never show the controls with guessed values: a leader who sees "not
  // private" for a private group may save the wrong state on top of it.
  if (error || !flags) {
    console.error("Failed to load the group's privacy settings:", error ?? "no row");
    return (
      <PageContainer>
        <PageHeader
          title="Privacy and joining"
          subtitle={group.name}
          backHref={groupPath(group.id, "/settings")}
          backLabel="Back to Group settings"
        />
        <p role="alert" className="text-lg text-muted-foreground">
          {SETTINGS_UNAVAILABLE_TEXT}
        </p>
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
