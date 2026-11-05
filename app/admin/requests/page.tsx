import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingState } from "@/components/states/LoadingState";
import { getPendingJoinRequests } from "@/lib/groups/pendingJoinRequests";
import { PENDING_GROUP_REQUEST_SELECT, toPendingGroupRequest } from "@/lib/groups/requests";
import { pageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { RequestsBoard } from "./RequestsBoard";

export const generateMetadata = () => pageTitle("Requests");

// The layout has already turned away anyone who isn't a church admin, and the
// admin arm of each SELECT policy returns the whole church's requests.
async function Requests() {
  const supabase = await createClient();
  const [accessRead, groupRead, groupsRead, timeZone] = await Promise.all([
    supabase
      .from("access_requests")
      .select("id, name, email, message, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("group_requests")
      .select(PENDING_GROUP_REQUEST_SELECT)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase.from("groups").select("id, name").order("name", { ascending: true }),
    getOrgTimeZone(),
  ]);
  // Without the groups there is nothing to read, and an empty queue would misreport the failure.
  const groups = readList(groupsRead, "groups for the join requests");

  return (
    <RequestsBoard
      access={readList(accessRead, "access requests")}
      group={readList(groupRead, "group requests")?.map(toPendingGroupRequest) ?? null}
      join={groups ? await getPendingJoinRequests(groups) : null}
      timeZone={timeZone}
    />
  );
}

export default function RequestsPage() {
  return (
    <PageContainer>
      <PageHeader title="Requests" />
      <Suspense fallback={<LoadingState thing="requests" />}>
        <Requests />
      </Suspense>
    </PageContainer>
  );
}
