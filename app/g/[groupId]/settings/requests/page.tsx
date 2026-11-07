import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { NO_PENDING_TEXT, parseJoinPolicy, pendingRequestsEmptyText } from "@/lib/groups/joining";
import { requireGroupSettingsLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { logError } from "@/lib/log";
import { JoinRequestsManager } from "./JoinRequestsManager";

export const generateMetadata = groupPageTitle("Requests");

export default async function GroupRequestsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupSettingsLeader(groupId);
  const supabase = await createClient();
  const [{ data: flags, error }, timeZone] = await Promise.all([
    supabase.from("groups").select("join_policy").eq("id", group.id).maybeSingle(),
    getOrgTimeZone(),
  ]);
  // The policy only words the empty list, so a failed read still shows the requests.
  if (error || !flags) {
    logError("Failed to load the group's join policy", error ?? "no row", { route: "/g/[groupId]/settings/requests" });
  }
  const emptyText = flags ? pendingRequestsEmptyText(parseJoinPolicy(flags.join_policy)) : NO_PENDING_TEXT;

  return (
    <PageContainer>
      <PageHeader title="Requests" subtitle={`Requests to join ${group.name}.`} />
      <JoinRequestsManager
        groupId={group.id}
        groupName={group.name}
        emptyText={emptyText}
        timeZone={timeZone}
      />
    </PageContainer>
  );
}
