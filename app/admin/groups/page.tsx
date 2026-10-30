import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminCreateGroupButton } from "@/components/admin/AdminCreateGroupButton";
import { AdminGroupList } from "@/components/admin/AdminGroupList";
import { OrgGroupControls } from "@/components/admin/OrgGroupControls";
import { PendingGroupRequests } from "@/components/admin/PendingGroupRequests";
import { PendingJoinRequests } from "@/components/admin/PendingJoinRequests";
import { GroupDiscoverySettings } from "@/components/groups/GroupDiscoverySettings";
import { getGroupCreationPolicy } from "@/lib/groups/creationPolicy";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { getPendingJoinRequests } from "@/lib/groups/pendingJoinRequests";
import { PENDING_GROUP_REQUEST_SELECT, toPendingGroupRequest } from "@/lib/groups/requests";
import { siteConfig } from "@/lib/config";
import { displayName } from "@/lib/names";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const metadata = { title: `Groups | Admin | ${siteConfig.name}` };

export default async function AdminGroupsPage() {
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
  const [
    policy,
    discoveryOn,
    { data: requests, error: requestsError },
    { data: groups, error: groupsError },
  ] = await Promise.all([
    getGroupCreationPolicy(),
    getDiscoveryOn(),
    supabase
      .from("group_requests")
      .select(PENDING_GROUP_REQUEST_SELECT)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("groups")
      .select(
        "id, name, description, members:group_members(count), leaders:group_members(profiles(first_name, last_name, preferred_name))",
      )
      .eq("leaders.role", "leader")
      .order("name", { ascending: true }),
  ]);
  if (requestsError) console.error("Failed to load group requests:", requestsError);
  if (groupsError) console.error("Failed to load groups:", groupsError);

  const timeZone = await getOrgTimeZone();
  const pending = (requests ?? []).map(toPendingGroupRequest);
  const groupRows = (groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g.members[0]?.count ?? 0,
    leaderNames: g.leaders
      .map((l) => displayName(Array.isArray(l.profiles) ? l.profiles[0] : l.profiles))
      .sort((a, b) => a.localeCompare(b)),
  }));
  // Without the groups there is nothing to read, and an empty queue would misreport the failure.
  const joinRequests = groupsError ? null : await getPendingJoinRequests(groupRows);

  return (
    <PageContainer size="wide">
      <PageHeader title="Groups" actions={<AdminCreateGroupButton />} />

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Group settings</h2>
        <div className="space-y-4">
          <GroupDiscoverySettings orgId={profile.org_id} discoveryOn={discoveryOn} />
          <OrgGroupControls orgId={profile.org_id} policy={policy} />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Pending group requests</h2>
        <PendingGroupRequests initialRequests={pending} timeZone={timeZone} />
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Pending join requests</h2>
        {joinRequests === null ? (
          <p role="alert" className="text-lg text-muted-foreground">
            Couldn&apos;t load the join requests. Reload the page to try again.
          </p>
        ) : (
          <PendingJoinRequests initialRequests={joinRequests} timeZone={timeZone} />
        )}
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Groups</h2>
        {groupsError ? (
          <p role="alert" className="text-lg text-muted-foreground">
            Couldn&apos;t load the groups. Reload the page to try again.
          </p>
        ) : (
          <AdminGroupList groups={groupRows} />
        )}
      </section>
    </PageContainer>
  );
}
