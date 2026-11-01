import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminGroupList } from "@/components/admin/AdminGroupList";
import { listAdminGroups } from "@/components/admin/adminGroups";
import { OrgGroupControls } from "@/components/admin/OrgGroupControls";
import { PendingGroupRequests } from "@/components/admin/PendingGroupRequests";
import { PendingJoinRequests } from "@/components/admin/PendingJoinRequests";
import { GroupDiscoverySettings } from "@/components/groups/GroupDiscoverySettings";
import { ErrorState } from "@/components/states/ErrorState";
import { getGroupCreationPolicy } from "@/lib/groups/creationPolicy";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { getPendingJoinRequests } from "@/lib/groups/pendingJoinRequests";
import { PENDING_GROUP_REQUEST_SELECT, toPendingGroupRequest } from "@/lib/groups/requests";
import { getGroupMemberships } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export async function AdminGroupsContent() {
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  // The admin arms of the three SELECT policies return the whole org.
  const [policy, discoveryOn, requestRead, groupRows, memberships] = await Promise.all([
    getGroupCreationPolicy(),
    getDiscoveryOn(),
    supabase
      .from("group_requests")
      .select(PENDING_GROUP_REQUEST_SELECT)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    listAdminGroups(supabase),
    // Without these every row links to its admin page rather than failing all of Groups.
    getGroupMemberships().catch(() => []),
  ]);

  const timeZone = await getOrgTimeZone();
  const requests = readList(requestRead, "group requests");
  // Without the groups there is nothing to read, and an empty queue would misreport the failure.
  const joinRequests = groupRows ? await getPendingJoinRequests(groupRows) : null;

  return (
    <>
      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Group requests</h2>
        {requests ? (
          <PendingGroupRequests
            initialRequests={requests.map(toPendingGroupRequest)}
            timeZone={timeZone}
          />
        ) : (
          <ErrorState thing="the group requests" />
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Join requests</h2>
        {joinRequests ? (
          <PendingJoinRequests initialRequests={joinRequests} timeZone={timeZone} />
        ) : (
          <ErrorState thing="the join requests" />
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">All groups</h2>
        {groupRows ? (
          <AdminGroupList groups={groupRows} memberGroupIds={memberships.map((m) => m.id)} />
        ) : (
          <ErrorState thing="the groups" />
        )}
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Church-wide group rules</h2>
        <div className="space-y-4">
          <GroupDiscoverySettings orgId={profile.org_id} discoveryOn={discoveryOn} />
          <OrgGroupControls orgId={profile.org_id} policy={policy} />
        </div>
      </section>
    </>
  );
}
